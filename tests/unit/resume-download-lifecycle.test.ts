import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  acquire: vi.fn(), renew: vi.fn(), release: vi.fn(),
  storage: vi.fn(), sanitize: vi.fn(), watermark: vi.fn(),
  audit: vi.fn(), access: vi.fn(),
}))
vi.mock('@/server/services/watermark-lease', () => ({
  acquireWatermarkLease: mocks.acquire,
  renewWatermarkLease: mocks.renew,
  releaseWatermarkLease: mocks.release,
}))
vi.mock('@/server/authz', () => ({
  requireVerifiedCompany: vi.fn().mockResolvedValue({
    userId: 'member-01', companyId: 'company-01', role: 'RECRUITER',
  }),
}))
vi.mock('@/server/db', () => ({
  db: {
    resumeFile: { findUnique: vi.fn().mockResolvedValue({
      id: 'cjld2cyuq0000t3rmniod1foy',
      storageKey: 'resumes/student-01/cv.pdf',
      fileName: 'cv.pdf',
      studentId: 'student-01',
      sizeBytes: 1000,
    }) },
    company: { findUnique: vi.fn().mockResolvedValue({
      id: 'company-01', legalName: 'Example Ltd', displayNameEn: null,
    }) },
  },
}))
vi.mock('@/server/services/contact-access', () => ({ identityAccess: mocks.access }))
vi.mock('@/lib/storage', () => ({ getObjectBytes: mocks.storage }))
vi.mock('@/server/lib/pdf-sanitize', () => ({ sanitizePdf: mocks.sanitize }))
vi.mock('@/server/lib/pdf-watermark', () => ({ watermarkPdf: mocks.watermark }))
vi.mock('@/server/services/audit', () => ({ logAudit: mocks.audit }))
vi.mock('@/server/services/settings', () => ({
  getSetting: vi.fn().mockImplementation(async (_key: string, fallback: unknown) => fallback),
}))
vi.mock('@/server/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}))

// Keep the production route wrapper and response/body behavior.
import { GET } from '@/app/api/resumes/[id]/download/route'

const LEASE = {
  id: 'lease-01',
  scope: 'resume-watermark',
  ownerKey: 'member-01',
  expiresAt: new Date('2099-01-01T00:00:00Z'),
  createdAt: new Date('2026-11-09T00:00:00Z'),
}
const INPUT = Buffer.from('bounded input fixture')
const SANITIZED = Buffer.from('bounded sanitized fixture')
// Larger than several stream chunks so an unread body cannot be mistaken for EOF.
const OUTPUT = Buffer.alloc(256 * 1024, 0x61)
const responses: Response[] = []

function request(signal?: AbortSignal) {
  return new Request('https://download.example.test/api/resumes/cjld2cyuq0000t3rmniod1foy/download', {
    signal,
  })
}

async function download(req = request()) {
  const response = await GET(req)
  responses.push(response)
  return response
}

beforeEach(() => {
  responses.length = 0
  mocks.acquire.mockReset().mockResolvedValue({ ...LEASE })
  mocks.renew.mockReset().mockResolvedValue(true)
  mocks.release.mockReset().mockResolvedValue(undefined)
  mocks.storage.mockReset().mockResolvedValue(INPUT)
  mocks.sanitize.mockReset().mockResolvedValue({ ok: true, pdf: SANITIZED })
  mocks.watermark.mockReset().mockResolvedValue({ ok: true, pdf: OUTPUT })
  mocks.audit.mockReset().mockResolvedValue(undefined)
  mocks.access.mockReset().mockResolvedValue('ok')
})

afterEach(async () => {
  for (const response of responses) {
    if (response.body && !response.bodyUsed) await response.body.cancel().catch(() => {})
  }
  vi.useRealTimers()
})

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

type Stage = 'storage' | 'sanitize' | 'watermark'

function holdStage(stage: Stage, delayAbort = false) {
  const entered = deferred<AbortSignal | undefined>()
  const operation = deferred<unknown>()
  let settled = false
  let releasedBeforeStop = false
  const stop = () => operation.reject(Object.assign(new Error('Operation aborted'), { name: 'AbortError' }))
  mocks.release.mockImplementation(async () => { releasedBeforeStop ||= !settled })
  const success = stage === 'storage'
    ? INPUT
    : { ok: true, pdf: stage === 'sanitize' ? SANITIZED : OUTPUT }
  mocks[stage].mockImplementation((...args: unknown[]) => {
    const options = args[stage === 'watermark' ? 2 : 1] as { signal?: AbortSignal } | undefined
    const signal = options?.signal
    entered.resolve(signal)
    signal?.addEventListener('abort', () => {
      if (!delayAbort) stop()
    }, { once: true })
    return operation.promise.finally(() => { settled = true })
  })
  return {
    entered: entered.promise,
    finish: () => operation.resolve(success),
    settled: () => settled,
    stop,
    releasedBeforeStop: () => releasedBeforeStop,
  }
}

describe('watermark download lease lifecycle (M4-T17)', () => {
  it('rejects exhausted shared capacity before starting S3 or PDF work', async () => {
    mocks.acquire.mockResolvedValueOnce(null)

    const response = await download()

    expect(response.status).toBe(429)
    expect(await response.json()).toMatchObject({ ok: false, code: 'RATE_LIMITED' })
    expect(mocks.acquire).toHaveBeenCalledExactlyOnceWith('member-01')
    expect(mocks.storage).not.toHaveBeenCalled()
    expect(mocks.sanitize).not.toHaveBeenCalled()
    expect(mocks.watermark).not.toHaveBeenCalled()
    expect(mocks.release).not.toHaveBeenCalled()
  })

  it('holds the lease until EOF and streams views of the bounded output buffer', async () => {
    const response = await download()
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('application/pdf')
    expect(mocks.acquire).toHaveBeenCalledExactlyOnceWith('member-01')
    expect(mocks.release).not.toHaveBeenCalled()
    if (!response.body) throw new Error('Expected a streamed body')
    const reader = response.body.getReader()
    let total = 0
    try {
      for (;;) {
        const result = await reader.read()
        if (result.done) break
        expect(result.value.buffer).toBe(OUTPUT.buffer)
        expect(result.value.byteOffset).toBe(OUTPUT.byteOffset + total)
        total += result.value.byteLength
      }
      expect(total).toBe(OUTPUT.byteLength)
      await vi.waitFor(() => {
        expect(mocks.release).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ id: LEASE.id }))
      })
    } finally {
      await reader.cancel().catch(() => {})
      reader.releaseLock()
    }
    expect(mocks.release).toHaveBeenCalledOnce()
  })

  it('releases once when the consumer cancels before EOF', async () => {
    const controller = new AbortController()
    const response = await download(request(controller.signal))
    expect(response.status).toBe(200)
    expect(mocks.release).not.toHaveBeenCalled()

    await response.body!.cancel('consumer disconnected')
    controller.abort()

    expect(mocks.release).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ id: LEASE.id }))
  })

  it('renews while the response remains open and stops renewing after cancellation', async () => {
    vi.useFakeTimers()
    const response = await download()
    expect(response.status).toBe(200)
    await vi.advanceTimersByTimeAsync(15_001)

    expect(mocks.renew).toHaveBeenCalledWith(expect.objectContaining({ id: LEASE.id }))
    expect(mocks.release).not.toHaveBeenCalled()
    await response.body!.cancel()
    expect(mocks.release).toHaveBeenCalledOnce()
    const renewals = mocks.renew.mock.calls.length
    await vi.advanceTimersByTimeAsync(60_000)
    expect(mocks.renew).toHaveBeenCalledTimes(renewals)
  })

  it('errors an open response and releases when renewal loses the lease', async () => {
    vi.useFakeTimers()
    mocks.renew.mockResolvedValueOnce(false)
    const response = await download()
    expect(response.status).toBe(200)

    await vi.advanceTimersByTimeAsync(15_001)

    await expect(response.arrayBuffer()).rejects.toThrow()
    expect(mocks.release).toHaveBeenCalledOnce()
    const renewals = mocks.renew.mock.calls.length
    await vi.advanceTimersByTimeAsync(60_000)
    expect(mocks.renew).toHaveBeenCalledTimes(renewals)
  })

  it.each(['storage', 'watermark'] as const)(
    'aborts pending %s at the local deadline while renewal remains unresolved',
    async stage => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] })
      const renewal = deferred<boolean>()
      mocks.renew.mockImplementationOnce(() => renewal.promise)
      const held = holdStage(stage)
      const pending = download()
      try {
        const signal = await held.entered
        expect(signal).toBeInstanceOf(AbortSignal)

        await vi.advanceTimersByTimeAsync(15_000)
        expect(mocks.renew).toHaveBeenCalledOnce()
        await vi.advanceTimersByTimeAsync(39_999)
        expect(signal!.aborted).toBe(false)
        expect(held.settled()).toBe(false)

        // Keep renewal unresolved: only the local deadline can stop this work.
        await vi.advanceTimersByTimeAsync(2)
        expect(signal!.aborted).toBe(true)
        expect(held.settled()).toBe(true)
        expect(mocks.release).not.toHaveBeenCalled()
        expect(mocks.audit).not.toHaveBeenCalled()

        // A late successful renewal must not revive the aborted operation.
        renewal.resolve(true)
        const response = await pending
        expect(response.status).not.toBe(200)
        expect(held.releasedBeforeStop()).toBe(false)
        expect(mocks.release).toHaveBeenCalledOnce()
        expect(mocks.audit).not.toHaveBeenCalled()
        await vi.advanceTimersByTimeAsync(60_000)
        expect(mocks.renew).toHaveBeenCalledOnce()
        expect(mocks.release).toHaveBeenCalledOnce()
      } finally {
        renewal.resolve(false)
        held.finish()
        await pending
      }
    },
  )

  it('errors an unread response at the local deadline while renewal remains unresolved', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] })
    const renewal = deferred<boolean>()
    mocks.renew.mockImplementationOnce(() => renewal.promise)
    const response = await download()
    let bodyRead: Promise<void> | undefined
    try {
      expect(response.status).toBe(200)
      await vi.advanceTimersByTimeAsync(15_000)
      expect(mocks.renew).toHaveBeenCalledOnce()
      await vi.advanceTimersByTimeAsync(39_999)
      expect(response.bodyUsed).toBe(false)
      expect(mocks.release).not.toHaveBeenCalled()

      // An open stream must fail without waiting for a hung database renewal.
      await vi.advanceTimersByTimeAsync(2)
      let readError: unknown
      let readSucceeded = false
      bodyRead = response.arrayBuffer().then(
        () => { readSucceeded = true },
        error => { readError = error },
      )
      await vi.advanceTimersByTimeAsync(0)
      expect(readSucceeded).toBe(false)
      expect(readError).toMatchObject({ name: 'AbortError' })
      expect(mocks.release).not.toHaveBeenCalled()

      renewal.resolve(true)
      await vi.advanceTimersByTimeAsync(0)
      expect(mocks.release).toHaveBeenCalledOnce()
      await vi.advanceTimersByTimeAsync(60_000)
      expect(mocks.renew).toHaveBeenCalledOnce()
      expect(mocks.release).toHaveBeenCalledOnce()
    } finally {
      renewal.resolve(false)
      await bodyRead
      if (response.body && !response.bodyUsed) await response.body.cancel().catch(() => {})
      await vi.advanceTimersByTimeAsync(0)
    }
  })

  it.each(['storage', 'sanitize', 'watermark'] as const)(
    'propagates request cancellation to %s and waits for it to stop before release',
    async stage => {
      const held = holdStage(stage, true)
      const controller = new AbortController()
      const pending = download(request(controller.signal))
      try {
        const signal = await held.entered
        expect(signal).toBeInstanceOf(AbortSignal)
        controller.abort()
        expect(signal!.aborted).toBe(true)
        await new Promise<void>(resolve => setImmediate(resolve))
        expect(mocks.release).not.toHaveBeenCalled()
        held.stop()
        const response = await pending

        expect(response.status).not.toBe(200)
        expect(held.settled()).toBe(true)
        expect(held.releasedBeforeStop()).toBe(false)
        expect(mocks.release).toHaveBeenCalledOnce()
        expect(mocks.audit).not.toHaveBeenCalled()
      } finally {
        held.finish()
        await pending
      }
    },
  )

  it.each([
    { stage: 'storage', renewal: 'lost' },
    { stage: 'storage', renewal: 'error' },
    { stage: 'watermark', renewal: 'lost' },
    { stage: 'watermark', renewal: 'error' },
  ] as const)(
    'aborts pending $stage work when renewal reports $renewal',
    async ({ stage, renewal }) => {
      vi.useFakeTimers()
      if (renewal === 'lost') mocks.renew.mockResolvedValueOnce(false)
      else mocks.renew.mockRejectedValueOnce(new Error('Lease database unavailable'))
      const held = holdStage(stage)
      const pending = download()
      try {
        const signal = await held.entered
        expect(signal).toBeInstanceOf(AbortSignal)

        await vi.advanceTimersByTimeAsync(15_001)

        expect(signal!.aborted).toBe(true)
        const response = await pending
        expect(response.status).not.toBe(200)
        expect(held.settled()).toBe(true)
        expect(held.releasedBeforeStop()).toBe(false)
        expect(mocks.release).toHaveBeenCalledOnce()
        expect(mocks.audit).not.toHaveBeenCalled()
      } finally {
        held.finish()
        await pending
      }
    },
  )

  it.each(['storage', 'sanitize', 'watermark'] as const)(
    'releases the lease after an unexpected %s error',
    async stage => {
      mocks[stage].mockRejectedValueOnce(new Error('private operation failure'))

      const response = await download()

      expect(response.status).toBe(500)
      expect(mocks.release).toHaveBeenCalledOnce()
      expect(mocks.audit).not.toHaveBeenCalled()
    },
  )

  it('releases after sanitizer rejection and never returns the original PDF', async () => {
    mocks.sanitize.mockResolvedValueOnce({ ok: false, reason: 'too_large' })

    const response = await download()

    expect(response.status).toBe(422)
    expect(await response.json()).toMatchObject({ ok: false, code: 'FILE_TOO_LARGE' })
    expect(mocks.watermark).not.toHaveBeenCalled()
    expect(mocks.release).toHaveBeenCalledOnce()
  })
})
