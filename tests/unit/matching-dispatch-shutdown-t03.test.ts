import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PgBoss } from 'pg-boss'
const io = vi.hoisted(() => ({ find: vi.fn(), config: vi.fn(), send: vi.fn(), globalStart: vi.fn(), globalSend: vi.fn(), warn: vi.fn(), capture: vi.fn() }))
vi.mock('@sentry/node', () => ({ captureException: io.capture }))
vi.mock('@/env', () => ({ env: {} }))
vi.mock('@/server/db', () => ({ db: { semanticIndex: { findMany: io.find } } }))
vi.mock('@/server/lib/logger', () => ({ logger: { info: vi.fn(), error: vi.fn(), warn: io.warn } }))
vi.mock('@/server/lib/healthchecks', () => ({ pingHealthcheck: vi.fn() }))
vi.mock('@/server/lib/matching-config', () => ({ getMatchingConfiguration: io.config, sameMatchingConfiguration: vi.fn() }))
vi.mock('@/server/jobs/boss', () => ({ sendBoss: { start: io.globalStart, send: io.globalSend } }))
vi.mock('@/server/services/settings', () => ({ getSetting: vi.fn().mockResolvedValue(5) }))
vi.mock('@/server/lib/ai/embedding-provider', () => ({ embedMatchingText: vi.fn() }))
vi.mock('@/server/lib/semantic-store', () => ({ deleteSemanticVector: vi.fn(), findJobNeighbors: vi.fn(), findTalentNeighbors: vi.fn(), isSemanticStoreAvailable: vi.fn() }))
vi.mock('@/server/services/contact-access', () => ({ canSeeIdentityMany: vi.fn() }))
vi.mock('@/server/services/talent-visibility', () => ({ isStudentVisibleToCompany: vi.fn() }))
vi.mock('@/server/lib/rate-limit', () => ({ checkRateLimit: vi.fn() }))
vi.mock('@/server/jobs/purge-unverified', () => ({ runPurgeUnverified: vi.fn() }))
vi.mock('@/server/jobs/requalify-referrals', () => ({ runRequalifyReferrals: vi.fn() }))
vi.mock('@/server/jobs/pilot-monthly-credits', () => ({ runPilotMonthlyCredits: vi.fn() }))
vi.mock('@/server/jobs/reconcile-wallets', () => ({ runReconcileWallets: vi.fn() }))
vi.mock('@/server/jobs/expire-invitations', () => ({ runExpireInvitations: vi.fn() }))
vi.mock('@/server/jobs/expire-subscriptions', () => ({ runExpireSubscriptions: vi.fn() }))
vi.mock('@/server/jobs/invoice-tasks', () => ({ runInvoiceTasks: vi.fn() }))
vi.mock('@/server/jobs/employer-daily-digest', () => ({ runEmployerDailyDigest: vi.fn() }))
vi.mock('@/server/jobs/export-user-data', () => ({ runExportUserData: vi.fn() }))
vi.mock('@/server/jobs/purge-deleted-accounts', () => ({ runPurgeDeletedAccounts: vi.fn() }))
import { createJobLifecycle, registerJobs } from '@/server/jobs/registry'
import { dispatchPendingMatchingIndexes } from '@/server/services/semantic-matching'

const pending = [{ id: 'c' + '1'.repeat(24), generation: 2 }, { id: 'c' + '2'.repeat(24), generation: 3 }]
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
beforeEach(() => {
  vi.clearAllMocks()
  io.find.mockReset().mockImplementation(async input => input.where.state === 'CANCELLED' ? [] : pending)
  io.config.mockReset().mockResolvedValue({ configurationId: 'matching-public-v1', model: 'synthetic', gateEpoch: 'synthetic', legalVersion: 'synthetic' })
  io.send.mockReset().mockResolvedValue('queued')
  io.globalStart.mockReset().mockResolvedValue(undefined)
  io.globalSend.mockReset().mockResolvedValue('forbidden-global-port')
})
afterEach(() => vi.useRealTimers())
describe('matching worker dispatch waits for the real current-boss send', () => {
  it('pending send → abort → actual settlement → lifecycle drain; no global client or next send', async () => {
    vi.useFakeTimers()
    const held = deferred<string | null>(), started = deferred<void>()
    io.send.mockImplementationOnce(() => { started.resolve(); return held.promise })
    type Handler = (jobs: Array<{ signal: AbortSignal }>) => Promise<void>
    const handlers = new Map<string, Handler>()
    const boss = { send: io.send, createQueue: vi.fn(), schedule: vi.fn(), work: vi.fn(async (name: string, options: unknown, handler?: Handler) => {
      handlers.set(name, (handler ?? options) as Handler)
    }) }
    const lifecycle = createJobLifecycle()
    await registerJobs(boss as unknown as PgBoss, lifecycle)
    const dispatch = handlers.get('dispatch-matching-indexes')
    expect(dispatch).toBeTypeOf('function')
    let finished = false, stopped = false
    const running = dispatch!([{ signal: new AbortController().signal }]).then(() => { finished = true })
    // A finite wait diagnoses missing port wiring in the compatible baseline.
    try {
      await vi.waitFor(() => expect(io.send).toHaveBeenCalledOnce())
      await started.promise
      const stopping = lifecycle.stop().then(() => { stopped = true })
      expect(lifecycle.signal.aborted).toBe(true)
      await vi.advanceTimersByTimeAsync(2501)
      expect(finished).toBe(false)
      expect(stopped).toBe(false)
      expect(io.globalStart).not.toHaveBeenCalled()
      expect(io.globalSend).not.toHaveBeenCalled()
      expect(io.send).toHaveBeenCalledExactlyOnceWith('matching-index', { indexId: pending[0].id, generation: 2 })
      held.resolve('queued-after-abort')
      await Promise.all([running, stopping])
      expect(stopped).toBe(true)
      await dispatch!([{ signal: new AbortController().signal }])
      expect(io.send).toHaveBeenCalledOnce()
    } finally {
      held.resolve('cleanup')
      await Promise.allSettled([running, lifecycle.stop()])
    }
  })
  it('already aborted direct dispatch performs no DB scan and no queue send', async () => {
    const controller = new AbortController(); controller.abort()
    await dispatchPendingMatchingIndexes({ signal: controller.signal, send: payload => io.send('matching-index', payload) })
    expect(io.find).not.toHaveBeenCalled()
    expect(io.send).not.toHaveBeenCalled()
    expect(io.globalStart).not.toHaveBeenCalled()
  })
  it.each(['null', 'reject'] as const)('a settled %s send preserves pending metadata and does not start another attempt', async result => {
    if (result === 'null') io.send.mockResolvedValue(null)
    else io.send.mockRejectedValue(new Error('PRIVATE_QUEUE_CONNECTION_STRING'))
    await dispatchPendingMatchingIndexes({ send: payload => io.send('matching-index', payload) })
    expect(io.send).toHaveBeenCalledOnce()
    expect(io.globalStart).not.toHaveBeenCalled()
    expect(JSON.stringify(io.warn.mock.calls)).not.toContain('PRIVATE_QUEUE_CONNECTION_STRING')
    expect(io.capture).not.toHaveBeenCalled()
  })
})
