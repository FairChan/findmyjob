import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { bounded, finishAll, observe, reachBarrier } from '../helpers/data-export-barriers-t01'

const fake = vi.hoisted(() => ({ send: vi.fn(), destroy: vi.fn(), key: crypto.randomUUID(), options: [] as Array<Record<string, unknown>> }))
vi.mock('server-only', () => ({}))
vi.mock('@/env', () => ({ env: {
  S3_ENDPOINT: 'https://synthetic.example.test', S3_REGION: 'test', S3_ACCESS_KEY_ID: fake.key,
  S3_SECRET_ACCESS_KEY: fake.key, S3_BUCKET: 'synthetic-bucket',
} }))
vi.mock('@aws-sdk/client-s3', () => {
  class Command { constructor(public input: Record<string, unknown>) {} }
  return {
    S3Client: class { send = fake.send; destroy = fake.destroy; constructor(options: Record<string, unknown>) { fake.options.push(options) } },
    PutObjectCommand: class extends Command {}, GetObjectCommand: class extends Command {},
    ListObjectVersionsCommand: class extends Command {}, DeleteObjectsCommand: class extends Command {},
  }
})
import { ListObjectVersionsCommand, DeleteObjectsCommand } from '@aws-sdk/client-s3'
import { deleteAllVersions, putObject } from '@/lib/storage'

beforeEach(() => { fake.send.mockReset(); fake.destroy.mockClear(); fake.options.length = 0 })
afterEach(() => vi.restoreAllMocks())

describe('T01 export storage integration fragment', () => {
  it('opts out of SDK retries for the physical export PUT only', async () => {
    fake.send.mockResolvedValue({})
    const options = { signal: new AbortController().signal, maxAttempts: 1 as const }
    await putObject('exports/owner/request/artifact.zip', Buffer.from('zip'), 'application/zip', options)
    expect(fake.options[0]).toMatchObject({ maxAttempts: 1 })
    expect(fake.send).toHaveBeenCalledTimes(1)
    expect(fake.destroy).toHaveBeenCalledTimes(1)
    await putObject('unrelated', Buffer.from('bytes'), 'application/octet-stream')
    expect(fake.options[1]).not.toHaveProperty('maxAttempts')
  })

  it('lists all pages before deleting versions and markers for only the exact key', async () => {
    const key = 'exports/owner/request/artifact.zip'
    fake.send.mockResolvedValueOnce({
      Versions: [{ Key: key, VersionId: 'v1' }, { Key: `${key}.other`, VersionId: 'other' }],
      IsTruncated: true, NextKeyMarker: key, NextVersionIdMarker: 'v1',
    }).mockResolvedValueOnce({ DeleteMarkers: [{ Key: key, VersionId: 'marker' }], Versions: [{ Key: key, VersionId: 'v2' }], IsTruncated: false })
      .mockResolvedValueOnce({})
    await deleteAllVersions(key)
    const commands = fake.send.mock.calls.map(([command]) => command)
    expect(commands[0]).toBeInstanceOf(ListObjectVersionsCommand)
    expect(commands[1]).toBeInstanceOf(ListObjectVersionsCommand)
    expect(commands[1].input).toMatchObject({ KeyMarker: key, VersionIdMarker: 'v1' })
    expect(commands[2]).toBeInstanceOf(DeleteObjectsCommand)
    expect(commands[2].input.Delete.Objects).toEqual([
      { Key: key, VersionId: 'v1' }, { Key: key, VersionId: 'v2' }, { Key: key, VersionId: 'marker' },
    ])
    expect(fake.send.mock.calls.every(([, options]) => options.abortSignal instanceof AbortSignal)).toBe(true)
  })

  it('chunks more than 1000 exact versions without ignoring per-object errors', async () => {
    const key = 'exports/test.zip'
    fake.send.mockResolvedValueOnce({ Versions: Array.from({ length: 1001 }, (_, i) => ({ Key: key, VersionId: String(i) })), IsTruncated: false })
      .mockResolvedValueOnce({}).mockResolvedValueOnce({ Errors: [{ Code: 'AccessDenied', Key: 'synthetic-private-key' }] })
    await expect(deleteAllVersions(key)).rejects.toThrow('Object deletion failed')
    expect(fake.send.mock.calls[1]![0].input.Delete.Objects).toHaveLength(1000)
    expect(fake.send.mock.calls[2]![0].input.Delete.Objects).toHaveLength(1)
    expect(fake.destroy).toHaveBeenCalledTimes(1)
  })

  it.each(['repeated', 'missing'] as const)('rejects %s pagination markers before any deletion', async kind => {
    fake.send.mockResolvedValue({ IsTruncated: true, ...(kind === 'repeated' ? { NextKeyMarker: 'same', NextVersionIdMarker: 'same' } : {}) })
    await expect(deleteAllVersions('exports/test.zip')).rejects.toThrow(/pagination/)
    expect(fake.send.mock.calls.every(([command]) => command instanceof ListObjectVersionsCommand)).toBe(true)
    expect(fake.send.mock.calls.length).toBeLessThanOrEqual(2)
  })

  it('caps distinct pagination markers at 100 pages', async () => {
    let page = 0
    fake.send.mockImplementation(async () => ({ IsTruncated: true, NextKeyMarker: `page-${++page}` }))
    await expect(deleteAllVersions('exports/test.zip')).rejects.toThrow('Object deletion listing limit')
    expect(fake.send).toHaveBeenCalledTimes(100)
    expect(fake.send.mock.calls.every(([command]) => command instanceof ListObjectVersionsCommand)).toBe(true)
  })

  it('refuses an already-expired finite deadline before constructing the SDK client', async () => {
    const aborted = AbortSignal.abort()
    vi.spyOn(AbortSignal, 'timeout').mockReturnValue(aborted)
    await expect(deleteAllVersions('exports/test.zip')).rejects.toMatchObject({ name: 'AbortError' })
    expect(fake.send).not.toHaveBeenCalled()
    // withMutationClient checks abort before constructing a client.
    expect(fake.options).toHaveLength(0)
    expect(AbortSignal.timeout).toHaveBeenCalledWith(45_000)
  })

  it('destroys the client when the default deadline aborts an in-flight page', async () => {
    const controller = new AbortController()
    vi.spyOn(AbortSignal, 'timeout').mockReturnValue(controller.signal)
    let entered!: () => void
    const started = new Promise<void>(resolve => { entered = resolve })
    fake.send.mockImplementation(async (_command, options: { abortSignal: AbortSignal }) => {
      entered()
      if (options.abortSignal.aborted) throw new Error('synthetic-abort')
      await new Promise<never>((_resolve, reject) => options.abortSignal.addEventListener('abort', () => reject(new Error('synthetic-abort')), { once: true }))
    })
    const deleting = observe(deleteAllVersions('exports/test.zip'))
    const checked = observe(expect(deleting).rejects.toMatchObject({ name: 'AbortError' }))
    try {
      await reachBarrier(started, deleting, 'In-flight storage page')
      controller.abort()
      await bounded(checked, 'Storage abort assertion')
    } finally {
      controller.abort()
      await finishAll([checked], 'Storage client completion')
    }
    expect(fake.destroy).toHaveBeenCalled()
    expect(fake.send).toHaveBeenCalledTimes(1)
  })
})
