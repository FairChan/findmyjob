import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DeleteObjectsCommand, ListObjectVersionsCommand, PutObjectCommand } from '@aws-sdk/client-s3'

const mock = vi.hoisted(() => ({ send: vi.fn(), destroy: vi.fn(), create: vi.fn(), key: crypto.randomUUID() }))
vi.mock('@/env', () => ({ env: {
  S3_ENDPOINT: 'http://storage.example.test', S3_REGION: 'test-region', S3_BUCKET: 'test-bucket',
  S3_ACCESS_KEY_ID: mock.key, S3_SECRET_ACCESS_KEY: mock.key,
} }))
vi.mock('@aws-sdk/client-s3', async importOriginal => {
  const actual = await importOriginal<typeof import('@aws-sdk/client-s3')>()
  return { ...actual, S3Client: class {
    constructor() { mock.create() }
    send = mock.send
    destroy = mock.destroy
  } }
})
import { deleteAllVersions, putObject } from '@/lib/storage'

const key = 'invoices/synthetic-company/synthetic-invoice/synthetic-candidate.pdf'
const bytes = Buffer.from('%PDF-1.7\nsynthetic')
const abortError = () => Object.assign(new Error('Synthetic cancellation'), { name: 'AbortError' })
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(res => { resolve = res })
  return { promise, resolve }
}

beforeEach(() => {
  mock.send.mockReset().mockResolvedValue({})
  mock.destroy.mockReset()
  mock.create.mockReset()
})

describe('T05 bounded storage mutations', () => {
  it('keeps existing put callers compatible and destroys the settled client', async () => {
    await putObject(key, bytes, 'application/pdf')
    expect(mock.send).toHaveBeenCalledExactlyOnceWith(expect.any(PutObjectCommand))
    expect(mock.send.mock.calls[0][0].input).toMatchObject({ Key: key, Body: bytes, ContentType: 'application/pdf' })
    expect(mock.destroy).toHaveBeenCalledOnce()
  })

  it.each(['put', 'delete'] as const)('does not begin %s for an already cancelled request', async kind => {
    const controller = new AbortController()
    controller.abort()
    const result = kind === 'put'
      ? putObject(key, bytes, 'application/pdf', { signal: controller.signal })
      : deleteAllVersions(key, { signal: controller.signal })
    await expect(result).rejects.toMatchObject({ name: 'AbortError' })
    expect(mock.create).not.toHaveBeenCalled()
    expect(mock.send).not.toHaveBeenCalled()
  })

  it.each(['put', 'delete'] as const)('passes cancellation to %s and waits for SDK settlement', async kind => {
    const controller = new AbortController()
    const entered = deferred<void>()
    const stopped = deferred<void>()
    const release = deferred<void>()
    mock.send.mockImplementation((_command, options?: { abortSignal?: AbortSignal }) => {
      entered.resolve()
      return new Promise((_resolve, reject) => {
        void release.promise.then(() => reject(abortError()))
        options?.abortSignal?.addEventListener('abort', () => {
          stopped.resolve()
        }, { once: true })
      })
    })
    let settled = false
    const task = (kind === 'put'
      ? putObject(key, bytes, 'application/pdf', { signal: controller.signal })
      : deleteAllVersions(key, { signal: controller.signal }))
      .then(() => ({ ok: true }), error => ({ ok: false, error }))
      .finally(() => { settled = true })
    try {
      await entered.promise
      const signal = mock.send.mock.calls[0][1]?.abortSignal as AbortSignal
      expect(signal).toBeInstanceOf(AbortSignal)
      expect(signal).toSatisfy((actual: AbortSignal) => kind === 'delete' || actual === controller.signal)
      expect(signal.aborted).toBe(false)
      controller.abort()
      await stopped.promise
      expect(signal.aborted).toBe(true)
      expect(signal.reason).toBe(controller.signal.reason)
      await Promise.resolve()
      expect(settled).toBe(false)
      expect(mock.destroy).toHaveBeenCalled()
      release.resolve()
      expect(await task).toMatchObject({ ok: false, error: { name: 'AbortError' } })
    } finally {
      // Make a failed assertion finite even against the no-signal RED baseline.
      controller.abort()
      release.resolve()
      await task
    }
  })

  it('passes the same signal to list and delete, deleting only the exact candidate', async () => {
    const controller = new AbortController()
    mock.send.mockResolvedValueOnce({
      Versions: [{ Key: key, VersionId: 'v1' }, { Key: key + '-other', VersionId: 'v2' }],
      DeleteMarkers: [{ Key: key, VersionId: 'marker1' }],
    }).mockResolvedValueOnce({})
    await deleteAllVersions(key, { signal: controller.signal })
    expect(mock.send.mock.calls).toHaveLength(2)
    expect(mock.send.mock.calls[0][0]).toBeInstanceOf(ListObjectVersionsCommand)
    expect(mock.send.mock.calls[1][0]).toBeInstanceOf(DeleteObjectsCommand)
    expect(mock.send.mock.calls[1][0].input.Delete.Objects).toEqual([
      { Key: key, VersionId: 'v1' }, { Key: key, VersionId: 'marker1' },
    ])
    const signal = mock.send.mock.calls[0][1]?.abortSignal as AbortSignal
    expect(signal).toBeInstanceOf(AbortSignal)
    expect(signal.aborted).toBe(false)
    for (const call of mock.send.mock.calls) expect(call[1]?.abortSignal).toBe(signal)
    controller.abort()
    expect(signal.aborted).toBe(true)
    expect(signal.reason).toBe(controller.signal.reason)
    expect(mock.destroy).toHaveBeenCalledOnce()
  })

  it('does not delete after cancellation arrives with the listing response', async () => {
    const controller = new AbortController()
    mock.send.mockImplementationOnce(async () => {
      controller.abort()
      return { Versions: [{ Key: key, VersionId: 'v1' }] }
    })
    await expect(deleteAllVersions(key, { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' })
    expect(mock.send).toHaveBeenCalledOnce()
    expect(mock.destroy).toHaveBeenCalled()
  })

  it('reports partial object deletion failure instead of treating cleanup as successful', async () => {
    mock.send.mockResolvedValueOnce({ Versions: [{ Key: key, VersionId: 'v1' }] })
      .mockResolvedValueOnce({ Errors: [{ Key: key, Code: 'AccessDenied' }] })
    await expect(deleteAllVersions(key)).rejects.toThrow('Object deletion failed')
    expect(mock.destroy).toHaveBeenCalledOnce()
  })

  it('releases the client when the provider rejects a put', async () => {
    mock.send.mockRejectedValueOnce(new Error('Synthetic storage failure'))
    await expect(putObject(key, bytes, 'application/pdf')).rejects.toThrow('Synthetic storage failure')
    expect(mock.destroy).toHaveBeenCalledOnce()
  })
})
