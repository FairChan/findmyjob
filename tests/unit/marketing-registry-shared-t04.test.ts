import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PgBoss } from 'pg-boss'

const io = vi.hoisted(() => ({ run: vi.fn(), schedule: vi.fn(), recover: vi.fn(), drain: vi.fn() }))
vi.mock('@sentry/node', () => ({ captureException: vi.fn() }))
vi.mock('@/server/db', () => ({ db: { $executeRaw: vi.fn() } }))
vi.mock('@/server/lib/logger', () => ({ logger: { info: vi.fn() } }))
vi.mock('@/server/lib/healthchecks', () => ({ pingHealthcheck: vi.fn() }))
vi.mock('@/server/services/settings', () => ({ getSetting: vi.fn().mockResolvedValue(5) }))
vi.mock('@/server/jobs/weekly-digest', () => ({ runWeeklyDigest: io.run, scheduleWeeklyDigests: io.schedule, recoverWeeklyDigests: io.recover, drainWeeklyDigestWork: io.drain }))
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

type Handler = (jobs: Array<{ data: unknown; signal: AbortSignal }>) => Promise<void>
function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>(yes => { resolve = yes })
  return { promise, resolve }
}
async function registered() {
  const handlers = new Map<string, Handler>()
  const boss = { createQueue: vi.fn(), schedule: vi.fn(), work: vi.fn(async (name: string, options: unknown, handler?: Handler) => { handlers.set(name, (handler ?? options) as Handler) }) }
  const lifecycle = createJobLifecycle()
  await registerJobs(boss as unknown as PgBoss, lifecycle)
  return { handlers, boss, lifecycle }
}
const job = (data: unknown, signal = new AbortController().signal) => ({ data, signal })
beforeEach(() => { vi.clearAllMocks(); io.run.mockResolvedValue(undefined); io.drain.mockResolvedValue(undefined) })
describe('weekly registry and true shutdown ownership', () => {
  it('uses KL weekly schedule and hourly recovery without replacing matching jobs', async () => {
    const { boss, handlers, lifecycle } = await registered()
    expect(boss.schedule).toHaveBeenCalledWith('schedule-weekly-digests', '0 8 * * 1', {}, { tz: 'Asia/Kuala_Lumpur', missed: 'once' })
    expect(boss.schedule).toHaveBeenCalledWith('recover-weekly-digests', '0 * * * *', {}, { tz: 'Asia/Kuala_Lumpur', missed: 'once' })
    expect(handlers.has('matching-index')).toBe(true)
    await lifecycle.stop()
  })
  it('accepts only deliveryId and never caller recipient/company overrides', async () => {
    const state = await registered()
    await expect(state.handlers.get('weekly-digest')!([job({ deliveryId: 'c' + '1'.repeat(24), userId: 'other' })])).rejects.toThrow('WEEKLY_DIGEST_PAYLOAD_INVALID')
    expect(io.run).not.toHaveBeenCalled()
    await state.lifecycle.stop()
  })
  it('aborts new work and waits for the timeout tail after runner return', async () => {
    const state = await registered(), entered = deferred(), tail = deferred()
    let signal!: AbortSignal
    io.run.mockImplementationOnce(async (_data, options: { signal: AbortSignal }) => { signal = options.signal })
    io.drain.mockImplementationOnce(async () => { entered.resolve(); await tail.promise })
    const running = state.handlers.get('weekly-digest')!([job({ deliveryId: 'c' + '1'.repeat(24) })])
    await entered.promise
    let stopped = false
    const stopping = state.lifecycle.stop().then(() => { stopped = true })
    expect(signal.aborted).toBe(true)
    await state.handlers.get('weekly-digest')!([job({ deliveryId: 'c' + '2'.repeat(24) })])
    expect(io.run).toHaveBeenCalledOnce()
    expect(stopped).toBe(false)
    tail.resolve()
    await Promise.all([running, stopping])
    expect(stopped).toBe(true)
  })
  it.each(['schedule-weekly-digests', 'recover-weekly-digests'])('rejects override payload in %s', async name => {
    const state = await registered()
    await expect(state.handlers.get(name)!([job({ now: 'past' })])).rejects.toThrow('WEEKLY_DIGEST_PAYLOAD_INVALID')
    expect(io.schedule).not.toHaveBeenCalled(); expect(io.recover).not.toHaveBeenCalled()
    await state.lifecycle.stop()
  })
})
