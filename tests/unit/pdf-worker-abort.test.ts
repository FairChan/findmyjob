import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Worker } from 'worker_threads'

const state = vi.hoisted(() => ({
  workers: [] as Worker[],
  getSetting: vi.fn(),
}))
vi.mock('@/server/services/settings', () => ({ getSetting: state.getSetting }))
vi.mock('worker_threads', async importOriginal => {
  const actual = await importOriginal<typeof import('worker_threads')>()
  return {
    ...actual,
    Worker: class extends actual.Worker {
      constructor(...args: ConstructorParameters<typeof actual.Worker>) {
        super(...args)
        state.workers.push(this)
      }
    },
  }
})

import { runCappedPdfWorker } from '@/server/lib/pdf-worker'
import { sanitizePdf } from '@/server/lib/pdf-sanitize'
import { watermarkPdf } from '@/server/lib/pdf-watermark'

beforeEach(() => {
  state.workers.length = 0
  state.getSetting.mockReset().mockResolvedValue(1024 * 1024)
})

afterEach(async () => {
  await Promise.all(state.workers.filter(worker => worker.threadId !== -1).map(worker => worker.terminate()))
})

describe('PDF worker cancellation (M4-T17)', () => {
  it('does not start a worker for an already aborted signal', async () => {
    const controller = new AbortController()
    controller.abort()

    const result = await runCappedPdfWorker('return 1', Buffer.alloc(0), undefined, {
      signal: controller.signal,
      timeoutMs: 5000,
    })

    expect(result).toMatchObject({ ok: false, reason: 'aborted' })
    expect(state.workers).toHaveLength(0)
  })

  it('terminates the running thread before resolving an aborted result', async () => {
    const started = new Int32Array(new SharedArrayBuffer(4))
    const controller = new AbortController()
    const pending = runCappedPdfWorker(
      'Atomics.store(params.started, 0, 1); while (true) {}',
      Buffer.alloc(0),
      { started },
      { maxInflatedBytes: 1024 * 1024, timeoutMs: 5000, signal: controller.signal },
    )

    try {
      await vi.waitFor(() => {
        expect(Atomics.load(started, 0)).toBe(1)
      }, { timeout: 4000, interval: 10 })
      expect(state.workers).toHaveLength(1)
      const worker = state.workers[0]
      expect(worker.threadId).not.toBe(-1)

      controller.abort()
      const result = await pending

      expect(result).toMatchObject({ ok: false, reason: 'aborted' })
      // Promise.race is insufficient: no thread may outlive the lease.
      expect(worker.threadId).toBe(-1)
    } finally {
      controller.abort()
      await Promise.all(state.workers.map(worker => worker.terminate()))
      await pending
    }
  }, 10_000)

  it('checks cancellation again after awaiting the settings lookup', async () => {
    let resolveSetting!: (value: number) => void
    state.getSetting.mockImplementationOnce(() => new Promise<number>(resolve => {
      resolveSetting = resolve
    }))
    const controller = new AbortController()
    const pending = runCappedPdfWorker('return 1', Buffer.alloc(0), undefined, {
      signal: controller.signal,
      timeoutMs: 5000,
    })
    controller.abort()
    resolveSetting(1024 * 1024)

    expect(await pending).toMatchObject({ ok: false, reason: 'aborted' })
    expect(state.workers).toHaveLength(0)
  })

  it.each(['sanitize', 'watermark'] as const)('forwards an aborted signal through %s', async operation => {
    const controller = new AbortController()
    controller.abort()
    const result = operation === 'sanitize'
      ? await sanitizePdf(Buffer.alloc(0), { signal: controller.signal })
      : await watermarkPdf(Buffer.alloc(0), { text: 'test' }, { signal: controller.signal })

    expect(result.ok).toBe(false)
    expect(state.workers).toHaveLength(0)
  })

  it('preserves the existing no-signal call contract', async () => {
    const result = await runCappedPdfWorker('return params.value', Buffer.alloc(0), { value: 7 })

    expect(result).toEqual({ ok: true, result: 7 })
  })
})
