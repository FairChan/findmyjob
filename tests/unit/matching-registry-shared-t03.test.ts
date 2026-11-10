import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PgBoss } from 'pg-boss'
const io = vi.hoisted(() => ({ index: vi.fn(), dispatch: vi.fn(), reconcile: vi.fn(), setting: vi.fn(), capture: vi.fn(), ping: vi.fn() }))
vi.mock('@sentry/node', () => ({ captureException: io.capture }))
vi.mock('@/server/db', () => ({ db: { $executeRaw: vi.fn() } }))
vi.mock('@/server/lib/logger', () => ({ logger: { info: vi.fn(), error: vi.fn() } }))
vi.mock('@/server/lib/healthchecks', () => ({ pingHealthcheck: io.ping }))
vi.mock('@/server/services/settings', () => ({ getSetting: io.setting }))
vi.mock('@/server/jobs/index-matching', () => ({ runMatchingIndex: io.index }))
vi.mock('@/server/services/semantic-matching', () => ({ dispatchPendingMatchingIndexes: io.dispatch, reconcileMatchingCorpus: io.reconcile }))
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
type Handler = (jobs: Array<{ data: { indexId: string; generation: number }; signal: AbortSignal }>) => Promise<void>
const payload = { indexId: 'c' + '1'.repeat(24), generation: 2 }
const queued = (signal = new AbortController().signal) => ({ data: payload, signal })
function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>(yes => { resolve = yes })
  return { promise, resolve }
}
async function registered() {
  const handlers = new Map<string, Handler>()
  const boss = { createQueue: vi.fn(), schedule: vi.fn(), work: vi.fn(async (name: string, options: unknown, handler?: Handler) => {
    handlers.set(name, (handler ?? options) as Handler)
  }) }
  const lifecycle = createJobLifecycle()
  await registerJobs(boss as unknown as PgBoss, lifecycle)
  return { handlers, boss, lifecycle }
}
function handler(handlers: Map<string, Handler>, name: string) {
  expect(handlers.has(name), `Missing ${name}`).toBe(true)
  return handlers.get(name)!
}
beforeEach(() => {
  vi.clearAllMocks()
  io.setting.mockReset().mockResolvedValue(5)
  io.index.mockReset().mockResolvedValue(undefined)
  io.dispatch.mockReset().mockResolvedValue(undefined)
  io.reconcile.mockReset().mockResolvedValue({ studentsVisited: 0, jobsVisited: 0, queued: 0 })
})
describe('matching registry owns real settlement through shutdown', () => {
  it('registers index, minute recovery and separate bounded corpus reconciliation', async () => {
    const { boss, lifecycle } = await registered()
    expect(boss.work).toHaveBeenCalledWith('matching-index', { localConcurrency: 1, batchSize: 1 }, expect.any(Function))
    expect(boss.schedule).toHaveBeenCalledWith('dispatch-matching-indexes', '* * * * *', {}, { missed: 'once' })
    expect(boss.schedule).toHaveBeenCalledWith('reconcile-matching-corpus', '*/5 * * * *', {}, { missed: 'once' })
    expect(io.setting).toHaveBeenCalledWith('ai.matching.reconcileEveryMinutes', 5, { fresh: true })
    await lifecycle.stop()
  })
  it.each([0, 31, 1.5, '5', null])('falls back to five minutes for invalid cadence %s', async value => {
    io.setting.mockResolvedValue(value)
    const { boss, lifecycle } = await registered()
    expect(boss.schedule).toHaveBeenCalledWith('reconcile-matching-corpus', '*/5 * * * *', {}, { missed: 'once' })
    await lifecycle.stop()
  })
  it('passes the exact payload and combined signal and waits for the runner on shutdown', async () => {
    const state = await registered(), held = deferred(), started = deferred()
    let signal!: AbortSignal
    io.index.mockImplementationOnce(async (_payload, options: { signal: AbortSignal }) => { signal = options.signal; started.resolve(); await held.promise })
    const running = handler(state.handlers, 'matching-index')([queued()])
    await started.promise
    let stopped = false
    const stopping = state.lifecycle.stop().then(() => { stopped = true })
    expect(signal.aborted).toBe(true)
    expect(io.index.mock.calls[0][0]).toBe(payload)
    expect(stopped).toBe(false)
    await handler(state.handlers, 'matching-index')([queued()])
    expect(io.index).toHaveBeenCalledOnce()
    held.resolve()
    await Promise.all([running, stopping])
  })
  it.each(['matching-index', 'dispatch-matching-indexes', 'reconcile-matching-corpus'])('does not admit an aborted %s', async name => {
    const state = await registered(), abort = new AbortController()
    abort.abort()
    await handler(state.handlers, name)([queued(abort.signal)])
    expect(io.index).not.toHaveBeenCalled()
    expect(io.dispatch).not.toHaveBeenCalled()
    expect(io.reconcile).not.toHaveBeenCalled()
    await state.lifecycle.stop()
  })
  it.each([
    ['matching-index', 'MATCHING_INDEX_JOB_FAILED', 'index'],
    ['dispatch-matching-indexes', 'MATCHING_INDEX_DISPATCH_FAILED', 'dispatch'],
    ['reconcile-matching-corpus', 'MATCHING_CORPUS_RECONCILE_FAILED', 'reconcile'],
  ] as const)('sanitizes unexpected failures of %s', async (name, code, operation) => {
    const state = await registered()
    io[operation].mockRejectedValueOnce(new Error('PRIVATE_PROVIDER_TEXT'))
    await expect(handler(state.handlers, name)([queued()])).rejects.toThrow(code)
    expect(io.capture).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ message: code }))
    expect(JSON.stringify(io.capture.mock.calls)).not.toContain('PRIVATE_PROVIDER_TEXT')
    expect(io.ping).not.toHaveBeenCalled()
    await state.lifecycle.stop()
  })
})
