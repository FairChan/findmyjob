import { Readable } from 'node:stream'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockSend = vi.hoisted(() => vi.fn())
vi.mock('@/env', () => ({
  env: {
    S3_ENDPOINT: 'http://storage.example.test',
    S3_REGION: 'test-region',
    S3_BUCKET: 'test-bucket',
    S3_ACCESS_KEY_ID: 'test-access-key',
    S3_SECRET_ACCESS_KEY: 'test-secret-key',
  },
}))
vi.mock('@aws-sdk/client-s3', async importOriginal => {
  const actual = await importOriginal<typeof import('@aws-sdk/client-s3')>()
  return { ...actual, S3Client: class { send = mockSend; destroy = vi.fn() } }
})

import { getObjectBytes } from '@/lib/storage'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(res => { resolve = res })
  return { promise, resolve }
}

function abortError() {
  return Object.assign(new Error('Request aborted'), { name: 'AbortError' })
}

function pendingBody() {
  const started = deferred<void>()
  const stream = new Readable({ read() { started.resolve() } })
  const body = Object.assign(stream, {
    transformToByteArray: vi.fn(async () => {
      started.resolve()
      const chunks: Buffer[] = []
      for await (const chunk of stream) chunks.push(Buffer.from(chunk))
      return Buffer.concat(chunks)
    }),
  })
  return { body, started: started.promise }
}

beforeEach(() => { mockSend.mockReset() })

describe('object download cancellation (M4-T17)', () => {
  it('passes the signal to the S3 request and preserves successful downloads', async () => {
    const controller = new AbortController()
    mockSend.mockResolvedValue({
      ContentLength: 3,
      Body: { transformToByteArray: async () => new Uint8Array([1, 2, 3]) },
    })

    const bytes = await getObjectBytes('resumes/test.pdf', { signal: controller.signal, maxBytes: 5 })

    expect(bytes).toEqual(Buffer.from([1, 2, 3]))
    expect(mockSend).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      abortSignal: controller.signal,
    }))
  })

  it('does not start S3 work for an already aborted request', async () => {
    const controller = new AbortController()
    controller.abort()
    mockSend.mockResolvedValue({
      Body: { transformToByteArray: async () => new Uint8Array([1]) },
    })

    await expect(getObjectBytes('resumes/test.pdf', { signal: controller.signal }))
      .rejects.toMatchObject({ name: 'AbortError' })
    expect(mockSend).not.toHaveBeenCalled()
  })

  it('aborts an in-flight S3 request through the SDK signal', async () => {
    const controller = new AbortController()
    const entered = deferred<void>()
    const fallback = deferred<{ Body: { transformToByteArray: () => Promise<Uint8Array> } }>()
    const stopped = vi.fn()
    mockSend.mockImplementation((_command, options?: { abortSignal?: AbortSignal }) => {
      entered.resolve()
      return new Promise((resolve, reject) => {
        options?.abortSignal?.addEventListener('abort', () => {
          stopped()
          reject(abortError())
        }, { once: true })
        void fallback.promise.then(resolve)
      })
    })
    const pending = getObjectBytes('resumes/test.pdf', { signal: controller.signal })
      .then(value => ({ ok: true, value }), error => ({ ok: false, error }))

    try {
      await entered.promise
      controller.abort()
      expect(stopped).toHaveBeenCalledOnce()
      expect(await pending).toMatchObject({ ok: false, error: { name: 'AbortError' } })
    } finally {
      fallback.resolve({ Body: { transformToByteArray: async () => new Uint8Array() } })
      await pending
    }
  })

  it('destroys the response body when aborted after S3 headers arrive', async () => {
    const controller = new AbortController()
    const { body, started } = pendingBody()
    mockSend.mockResolvedValue({ Body: body })
    const pending = getObjectBytes('resumes/test.pdf', { signal: controller.signal })
      .then(value => ({ ok: true, value }), error => ({ ok: false, error }))

    try {
      await started
      controller.abort()

      await vi.waitFor(() => { expect(body.destroyed).toBe(true) }, { timeout: 500 })
      expect(await pending).toMatchObject({ ok: false, error: { name: 'AbortError' } })
    } finally {
      body.destroy(abortError())
      await pending
    }
  })
})
