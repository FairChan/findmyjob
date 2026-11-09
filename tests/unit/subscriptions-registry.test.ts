import { beforeEach, describe, expect, it, vi } from 'vitest'
const observed = vi.hoisted(() => ({ run: vi.fn(), ping: vi.fn(), capture: vi.fn() }))
vi.mock('@sentry/node', () => ({ captureException: observed.capture }))
vi.mock('@/server/db', () => ({ db: { $executeRaw: vi.fn() } }))
vi.mock('@/server/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))
vi.mock('@/server/lib/healthchecks', () => ({ pingHealthcheck: observed.ping }))
vi.mock('@/server/jobs/purge-unverified', () => ({ runPurgeUnverified: vi.fn() }))
vi.mock('@/server/jobs/requalify-referrals', () => ({ runRequalifyReferrals: vi.fn() }))
vi.mock('@/server/jobs/pilot-monthly-credits', () => ({ runPilotMonthlyCredits: vi.fn() }))
vi.mock('@/server/jobs/reconcile-wallets', () => ({ runReconcileWallets: vi.fn() }))
vi.mock('@/server/jobs/expire-invitations', () => ({ runExpireInvitations: vi.fn() }))
vi.mock('@/server/jobs/employer-daily-digest', () => ({ runEmployerDailyDigest: vi.fn() }))
vi.mock('@/server/jobs/export-user-data', () => ({ runExportUserData: vi.fn() }))
vi.mock('@/server/jobs/purge-deleted-accounts', () => ({ runPurgeDeletedAccounts: vi.fn() }))
vi.mock('@/server/jobs/expire-subscriptions', () => ({ runExpireSubscriptions: observed.run }))
import { registerJobs } from '@/server/jobs/registry'
beforeEach(() => {
  vi.clearAllMocks()
  observed.run.mockReset().mockResolvedValue(undefined)
})
async function registration() {
  const boss = { createQueue: vi.fn().mockResolvedValue(undefined), schedule: vi.fn().mockResolvedValue(undefined), work: vi.fn().mockResolvedValue(undefined) }
  await registerJobs(boss as unknown as Parameters<typeof registerJobs>[0])
  const calls = boss.work.mock.calls as unknown[][]
  const call = calls.find((args) => args[0] === 'expire-subscriptions')
  expect(call, 'Missing expire-subscriptions worker').toBeDefined()
  return { boss, handler: call![1] as () => Promise<void> }
}
describe('M8-T04 expiry worker registration', () => {
  it('registers the daily 00:30 KL schedule with missed:once', async () => {
    const { boss } = await registration()
    expect(boss.createQueue).toHaveBeenCalledWith('expire-subscriptions')
    expect(boss.schedule).toHaveBeenCalledWith('expire-subscriptions', '30 0 * * *', {}, { tz: 'Asia/Kuala_Lumpur', missed: 'once' })
  })
  it('runs the service and pings only after successful completion', async () => {
    const { handler } = await registration()
    await handler()
    expect(observed.run).toHaveBeenCalledTimes(1)
    expect(observed.ping).toHaveBeenCalledExactlyOnceWith('expire-subscriptions')
    expect(observed.capture).not.toHaveBeenCalled()
  })
  it('propagates failure for retry without reporting healthy completion', async () => {
    const { handler } = await registration()
    const error = new Error('Synthetic expiry failure')
    observed.run.mockRejectedValueOnce(error)
    await expect(handler()).rejects.toBe(error)
    expect(observed.capture).toHaveBeenCalledWith(error)
    expect(observed.ping).not.toHaveBeenCalled()
  })
})
