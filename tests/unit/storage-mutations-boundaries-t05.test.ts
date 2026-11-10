import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DeleteObjectsCommand, ListObjectVersionsCommand, PutObjectCommand } from '@aws-sdk/client-s3'

const sdk = vi.hoisted(() => ({ send: vi.fn(), destroy: vi.fn(), create: vi.fn(), credential: crypto.randomUUID() }))
vi.mock('@/env', () => ({ env: {
  S3_ENDPOINT: 'http://storage.example.test', S3_REGION: 'test-region', S3_BUCKET: 'test-bucket',
  S3_ACCESS_KEY_ID: sdk.credential, S3_SECRET_ACCESS_KEY: sdk.credential,
} }))
vi.mock('@aws-sdk/client-s3', async importOriginal => {
  const actual = await importOriginal<typeof import('@aws-sdk/client-s3')>()
  return { ...actual, S3Client: class {
    constructor() { sdk.create() }
    send = sdk.send
    destroy = sdk.destroy
  } }
})
import { deleteAllVersions, putObject } from '@/lib/storage'

const key = 'invoices/synthetic-company/synthetic-invoice/candidate.pdf'
const bytes = Buffer.from('%PDF-1.7\nSYNTHETIC_MUTATION')
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(res => { resolve = res })
  return { promise, resolve }
}
async function enteredOrSettled<T>(entered: Promise<T>, settled: Promise<unknown>): Promise<T> {
  return Promise.race([entered, settled.then(() => { throw new Error('Mutation settled before its SDK barrier') })])
}

beforeEach(() => {
  vi.resetAllMocks()
  sdk.send.mockResolvedValue({})
})
afterEach(() => vi.restoreAllMocks())

describe('T05 additional storage mutation boundaries', () => {
  it('cancels the DeleteObjects request after listing and waits for its SDK settlement', async () => {
    const controller = new AbortController()
    const entered = deferred<void>()
    const aborted = deferred<void>()
    const release = deferred<void>()
    sdk.send.mockResolvedValueOnce({ Versions: [{ Key: key, VersionId: 'candidate-version' }] })
      .mockImplementationOnce(async (command, options?: { abortSignal?: AbortSignal }) => {
        expect(command).toBeInstanceOf(DeleteObjectsCommand)
        options?.abortSignal?.addEventListener('abort', () => aborted.resolve(), { once: true })
        entered.resolve()
        await release.promise
        throw Object.assign(new Error('Synthetic delete cancelled'), { name: 'AbortError' })
      })
    let finished = false
    const settled = Promise.allSettled([deleteAllVersions(key, { signal: controller.signal })])
      .then(result => { finished = true; return result })
    try {
      await enteredOrSettled(entered.promise, settled)
      expect(sdk.send.mock.calls[0][0]).toBeInstanceOf(ListObjectVersionsCommand)
      const signal = sdk.send.mock.calls[1][1]?.abortSignal as AbortSignal
      expect(signal).toBeInstanceOf(AbortSignal)
      expect(signal).toBe(sdk.send.mock.calls[0][1]?.abortSignal)
      expect(signal.aborted).toBe(false)
      controller.abort()
      await enteredOrSettled(aborted.promise, settled)
      expect(signal.aborted).toBe(true)
      expect(signal.reason).toBe(controller.signal.reason)
      expect(finished).toBe(false)
      expect(sdk.destroy).toHaveBeenCalled()
    } finally {
      controller.abort()
      release.resolve()
      await settled
    }
    expect(await settled).toMatchObject([{ status: 'rejected', reason: { name: 'AbortError' } }])
    expect(sdk.send).toHaveBeenCalledTimes(2)
  })

  it.each(['put', 'delete'] as const)('rejects %s when the SDK resolves successfully after cancellation', async kind => {
    const controller = new AbortController()
    const entered = deferred<void>()
    const release = deferred<void>()
    if (kind === 'delete') sdk.send.mockResolvedValueOnce({ Versions: [{ Key: key, VersionId: 'candidate-version' }] })
    sdk.send.mockImplementationOnce(async () => {
      entered.resolve()
      await release.promise
      return {}
    })
    const settled = Promise.allSettled([kind === 'put'
      ? putObject(key, bytes, 'application/pdf', { signal: controller.signal })
      : deleteAllVersions(key, { signal: controller.signal })])
    try {
      await enteredOrSettled(entered.promise, settled)
      const call = sdk.send.mock.calls.at(-1)!
      expect(call[0]).toBeInstanceOf(kind === 'put' ? PutObjectCommand : DeleteObjectsCommand)
      const signal = call[1]?.abortSignal as AbortSignal
      expect(signal).toBeInstanceOf(AbortSignal)
      expect(signal).toSatisfy((actual: AbortSignal) => kind === 'delete' || actual === controller.signal)
      expect(signal.aborted).toBe(false)
      controller.abort()
      expect(signal.aborted).toBe(true)
      expect(signal.reason).toBe(controller.signal.reason)
    } finally {
      controller.abort()
      release.resolve()
      await settled
    }
    expect(await settled).toMatchObject([{ status: 'rejected', reason: { name: 'AbortError' } }])
    expect(sdk.destroy).toHaveBeenCalled()
  })

  it('preserves an existing one-argument delete with no exact candidate versions', async () => {
    sdk.send.mockResolvedValueOnce({ Versions: [{ Key: key + '-other', VersionId: 'unrelated' }] })
    await deleteAllVersions(key)
    expect(sdk.send).toHaveBeenCalledExactlyOnceWith(expect.any(ListObjectVersionsCommand), { abortSignal: expect.any(AbortSignal) })
    expect(sdk.send.mock.calls[0][1]?.abortSignal.aborted).toBe(false)
    expect(sdk.destroy).toHaveBeenCalledOnce()
  })

  it.each(['success', 'failure'] as const)('removes the abort listener after SDK %s', async outcome => {
    const controller = new AbortController()
    if (outcome === 'failure') sdk.send.mockRejectedValueOnce(new Error('Synthetic upload failure'))
    const result = await Promise.allSettled([putObject(key, bytes, 'application/pdf', { signal: controller.signal })])
    expect(result[0].status).toBe(outcome === 'success' ? 'fulfilled' : 'rejected')
    expect(sdk.destroy).toHaveBeenCalledOnce()
    controller.abort()
    expect(sdk.destroy).toHaveBeenCalledOnce()
  })
})
