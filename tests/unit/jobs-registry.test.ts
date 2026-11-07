/**
 * Unit tests for job registry schedule options (M4-T20 task 3).
 * Verifies pilot-monthly-credits and reconcile-wallets use KL timezone + missed:'once'.
 */
import { vi, describe, it, expect } from 'vitest'

vi.mock('@sentry/node', () => ({ captureException: vi.fn() }))
vi.mock('@prisma/client', () => ({
  Prisma: { sql: vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => ({ sql: strings.join('?'), values })) },
}))
vi.mock('@/server/db', () => ({ db: { $executeRaw: vi.fn().mockResolvedValue(0) } }))
vi.mock('@/server/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))
vi.mock('@/server/jobs/purge-unverified', () => ({ runPurgeUnverified: vi.fn() }))
vi.mock('@/server/jobs/requalify-referrals', () => ({ runRequalifyReferrals: vi.fn() }))
vi.mock('@/server/jobs/pilot-monthly-credits', () => ({ runPilotMonthlyCredits: vi.fn() }))
vi.mock('@/server/jobs/reconcile-wallets', () => ({ runReconcileWallets: vi.fn() }))
vi.mock('@/server/lib/healthchecks', () => ({ pingHealthcheck: vi.fn() }))

import { registerJobs } from '@/server/jobs/registry'

function makeBoss() {
  return {
    createQueue: vi.fn().mockResolvedValue(undefined),
    schedule: vi.fn().mockResolvedValue(undefined),
    work: vi.fn().mockResolvedValue(undefined),
  }
}

describe('registerJobs: schedule timezone options', () => {
  it('pilot-monthly-credits is scheduled at 00:10 KL with missed:once', async () => {
    const boss = makeBoss()
    await registerJobs(boss as unknown as Parameters<typeof registerJobs>[0])

    const scheduleCalls = boss.schedule.mock.calls as unknown[][]
    const call = scheduleCalls.find((c) => c[0] === 'pilot-monthly-credits')
    expect(call, 'pilot-monthly-credits schedule call not found').toBeDefined()
    expect(call?.[1]).toBe('10 0 1 * *')
    expect(call?.[3]).toMatchObject({ tz: 'Asia/Kuala_Lumpur', missed: 'once' })
  })

  it('reconcile-wallets is scheduled at 03:00 KL with missed:once', async () => {
    const boss = makeBoss()
    await registerJobs(boss as unknown as Parameters<typeof registerJobs>[0])

    const scheduleCalls = boss.schedule.mock.calls as unknown[][]
    const call = scheduleCalls.find((c) => c[0] === 'reconcile-wallets')
    expect(call, 'reconcile-wallets schedule call not found').toBeDefined()
    expect(call?.[1]).toBe('0 3 * * *')
    expect(call?.[3]).toMatchObject({ tz: 'Asia/Kuala_Lumpur', missed: 'once' })
  })
})
