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
vi.mock('@/server/jobs/expire-subscriptions', () => ({ runExpireSubscriptions: vi.fn() }))
vi.mock('@/server/jobs/employer-daily-digest', () => ({ runEmployerDailyDigest: vi.fn() }))
vi.mock('@/server/jobs/export-user-data', () => ({ runExportUserData: vi.fn() }))
vi.mock('@/server/jobs/purge-deleted-accounts', () => ({ runPurgeDeletedAccounts: vi.fn() }))
vi.mock('@/server/jobs/invoice-tasks', () => ({ runInvoiceTasks: observed.run }))
import { registerJobs } from '@/server/jobs/registry'
import { AppError } from '@/server/errors'

beforeEach(() => {
  vi.clearAllMocks()
  observed.run.mockReset().mockResolvedValue(undefined)
})
async function registration() {
  const boss = {
    createQueue: vi.fn().mockResolvedValue(undefined),
    schedule: vi.fn().mockResolvedValue(undefined),
    work: vi.fn().mockResolvedValue(undefined),
  }
  await registerJobs(boss as unknown as Parameters<typeof registerJobs>[0])
  const call = (boss.work.mock.calls as unknown[][]).find(args => args[0] === 'invoice-tasks')
  expect(call, 'Missing invoice-tasks worker').toBeDefined()
  return { boss, handler: call![1] as () => Promise<void> }
}

describe('T05 invoice task registration', () => {
  it('registers every minute in KL with missed:once', async () => {
    const { boss } = await registration()
    expect(boss.createQueue).toHaveBeenCalledWith('invoice-tasks')
    expect(boss.schedule).toHaveBeenCalledWith('invoice-tasks', '* * * * *', {}, {
      tz: 'Asia/Kuala_Lumpur', missed: 'once',
    })
  })

  it('awaits completion before pinging health or completing the worker', async () => {
    const { handler } = await registration()
    let release!: () => void
    observed.run.mockImplementationOnce(() => new Promise<void>(resolve => { release = resolve }))
    let finished = false
    const running = handler().then(() => { finished = true })
    try {
      expect(observed.run).toHaveBeenCalledTimes(1)
      expect(finished).toBe(false)
      expect(observed.ping).not.toHaveBeenCalled()
    } finally {
      release()
      await running
    }
    expect(observed.ping).toHaveBeenCalledExactlyOnceWith('invoice-tasks')
    expect(observed.capture).not.toHaveBeenCalled()
  })

  it('propagates the controlled runner error without reporting healthy completion', async () => {
    const { handler } = await registration()
    const error = new AppError('Invoice tasks failed', 'INVOICE_TASKS_FAILED', 503)
    observed.run.mockRejectedValueOnce(error)
    await expect(handler()).rejects.toBe(error)
    expect(observed.capture).toHaveBeenCalledExactlyOnceWith(error)
    expect(observed.ping).not.toHaveBeenCalled()
  })
})
