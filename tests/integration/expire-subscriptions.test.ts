/** In-app notifications stay real; the sole injected failure is one delivery write. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const faults = vi.hoisted(() => ({ userId: null as string | null, getObjectBytes: vi.fn(), notifyOrderConfirmed: vi.fn(), sendNotificationEmail: vi.fn() }))
vi.mock('@/server/auth', () => ({ getSession: vi.fn(), auth: {} }))
vi.mock('@/server/db', async () => ({ db: (await import('../setup/db')).testDb }))
vi.mock('@/lib/storage', () => ({ getObjectBytes: faults.getObjectBytes }))
vi.mock('@/server/services/notify', () => ({ notifyOrderConfirmed: faults.notifyOrderConfirmed, sendNotificationEmail: faults.sendNotificationEmail }))
vi.mock('@/server/services/notifications', async () => {
  const actual = await vi.importActual<typeof import('@/server/services/notifications')>('@/server/services/notifications')
  return { ...actual, createNotification: async (...args: Parameters<typeof actual.createNotification>) => {
    if (args[2] === 'subscription.expiring' && args[1] === faults.userId) throw new Error('Synthetic T04 notification write failure')
    return actual.createNotification(...args)
  } }
})
import { setupTestDb, testDb } from '../setup/db'
import { createEmployerWithoutCompany } from '../factories'
import { setting, PROOF_BYTES } from '../helpers/billing-t02'
import { configureBase, paidCompany, paySegment, moveSegment, seedJob, addMember, DAY, PAID_LIMITS } from '../helpers/subscriptions-t04'
import { runExpireSubscriptions } from '@/server/jobs/expire-subscriptions'
setupTestDb()
const NOW = new Date('2030-05-12T04:00:00.000Z')
beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
  faults.userId = null
  faults.getObjectBytes.mockReset().mockResolvedValue(PROOF_BYTES)
  faults.notifyOrderConfirmed.mockReset().mockResolvedValue(undefined)
  faults.sendNotificationEmail.mockReset().mockResolvedValue(undefined)
  await configureBase()
})
afterEach(() => vi.useRealTimers())
function reminders(userId?: string) {
  return testDb.notification.findMany({ where: { type: 'subscription.expiring', ...(userId ? { userId } : {}) }, orderBy: { id: 'asc' } })
}

describe('M8-T04 expiry and seven-day reminders', () => {
  it.each([7 * DAY, 7 * DAY + 1, 3 * DAY, 1, 0, -1])('uses the catch-up window at delta=%i milliseconds', async (delta) => {
    const f = await paidCompany()
    const end = new Date(NOW.getTime() + delta)
    await moveSegment(f.subscription, end)
    await runExpireSubscriptions()
    const rows = await reminders(f.ctx.userId)
    const shouldRemind = delta > 0 && delta <= 7 * DAY
    const expectedPayload = expect.objectContaining({ subscriptionId: f.subscription.id })
    const expectedEnd = expect.arrayContaining([end.toISOString()])
    expect(rows.map((row) => row.payload)).toEqual(shouldRemind ? [expectedPayload] : [])
    expect(rows.map((row) => Object.values(row.payload as Record<string, unknown>))).toEqual(shouldRemind ? [expectedEnd] : [])
    expect(await testDb.subscription.findUnique({ where: { id: f.subscription.id } })).toMatchObject({ status: delta <= 0 ? 'EXPIRED' : 'ACTIVE' })
  })

  it('persists deduplication across repeated and concurrent runs independently of notification retention', async () => {
    const f = await paidCompany()
    await moveSegment(f.subscription, new Date(NOW.getTime() + 5 * DAY))
    await Promise.all([runExpireSubscriptions(), runExpireSubscriptions()])
    await runExpireSubscriptions()
    const rows = await reminders(f.ctx.userId)
    expect(rows).toHaveLength(1)
    // Simulate retention of this synthetic notification; a persistent reminder marker must survive it.
    await testDb.notification.delete({ where: { id: rows[0].id } })
    await runExpireSubscriptions()
    expect(await reminders(f.ctx.userId)).toHaveLength(0)
    expect(faults.sendNotificationEmail).not.toHaveBeenCalled()
  })

  it('does not warn about the current segment when a paid continuous renewal extends the service tail', async () => {
    const f = await paidCompany()
    const current = await moveSegment(f.subscription, new Date(NOW.getTime() + 5 * DAY))
    const future = await paySegment(f)
    expect(future.startsAt).toEqual(current.endsAt)
    await runExpireSubscriptions()
    expect(await reminders(f.ctx.userId)).toHaveLength(0)
    expect(await testDb.subscription.findUnique({ where: { id: future.id } })).toMatchObject({ status: 'ACTIVE' })
  })

  it('reminds once for a future chain tail inside seven days and not again at the segment boundary', async () => {
    const f = await paidCompany(PAID_LIMITS, 1)
    const future = await paySegment(f)
    expect(future.startsAt).toEqual(f.subscription.endsAt)
    expect(future.startsAt.getTime()).toBeGreaterThan(NOW.getTime())
    await setting('billing.enabled', false)
    await runExpireSubscriptions()
    expect(await reminders(f.ctx.userId)).toEqual([expect.objectContaining({ payload: expect.objectContaining({ subscriptionId: future.id }) })])
    vi.setSystemTime(future.startsAt)
    await runExpireSubscriptions()
    expect(await reminders(f.ctx.userId)).toHaveLength(1)
    expect(await testDb.subscription.findUnique({ where: { id: f.subscription.id } })).toMatchObject({ status: 'EXPIRED' })
    expect(await testDb.subscription.findUnique({ where: { id: future.id } })).toMatchObject({ status: 'ACTIVE' })
  })

  it('does not treat a gap before future service as continuous coverage', async () => {
    const f = await paidCompany(PAID_LIMITS, 1)
    const future = await paySegment(f)
    await testDb.subscription.update({ where: { id: future.id }, data: { startsAt: new Date(future.startsAt.getTime() + DAY), endsAt: new Date(future.endsAt.getTime() + DAY) } })
    await runExpireSubscriptions()
    expect(await reminders(f.ctx.userId)).toEqual([expect.objectContaining({ payload: expect.objectContaining({ subscriptionId: f.subscription.id }) })])
  })

  it.each(['PENDING', 'CANCELLED'] as const)('does not let a %s future order suppress the current expiry warning', async (status) => {
    const f = await paidCompany()
    await moveSegment(f.subscription, new Date(NOW.getTime() + 5 * DAY))
    const future = await paySegment(f)
    await testDb.order.update({ where: { id: future.orderId! }, data: { status } })
    await runExpireSubscriptions()
    expect(await reminders(f.ctx.userId)).toEqual([expect.objectContaining({ payload: expect.objectContaining({ subscriptionId: f.subscription.id }) })])
  })

  it('does not notify an unstarted-only or cancelled subscription', async () => {
    const f = await paidCompany()
    await testDb.subscription.update({ where: { id: f.subscription.id }, data: { startsAt: new Date(NOW.getTime() + DAY), endsAt: new Date(NOW.getTime() + 366 * DAY) } })
    await runExpireSubscriptions()
    expect(await reminders()).toHaveLength(0)
    await testDb.subscription.update({ where: { id: f.subscription.id }, data: { status: 'CANCELLED', startsAt: new Date(NOW.getTime() - DAY), endsAt: new Date(NOW.getTime() + DAY) } })
    await runExpireSubscriptions()
    expect(await reminders()).toHaveLength(0)
    expect(await testDb.subscription.findUnique({ where: { id: f.subscription.id } })).toMatchObject({ status: 'CANCELLED' })
  })

  it('expires elapsed rows without changing jobs, members, wallet or ledger', async () => {
    const f = await paidCompany()
    await seedJob(f.ctx)
    await addMember(f.ctx.companyId)
    await moveSegment(f.subscription, NOW)
    const before = {
      jobs: await testDb.job.findMany({ where: { companyId: f.ctx.companyId } }),
      members: await testDb.companyMember.findMany({ where: { companyId: f.ctx.companyId }, orderBy: { id: 'asc' } }),
      wallet: await testDb.creditWallet.findUnique({ where: { companyId: f.ctx.companyId } }),
      ledger: await testDb.creditLedger.findMany({ where: { wallet: { companyId: f.ctx.companyId } }, orderBy: { id: 'asc' } }),
    }
    await runExpireSubscriptions(); await runExpireSubscriptions()
    expect(await testDb.job.findMany({ where: { companyId: f.ctx.companyId } })).toEqual(before.jobs)
    expect(await testDb.companyMember.findMany({ where: { companyId: f.ctx.companyId }, orderBy: { id: 'asc' } })).toEqual(before.members)
    expect(await testDb.creditWallet.findUnique({ where: { companyId: f.ctx.companyId } })).toEqual(before.wallet)
    expect(await testDb.creditLedger.findMany({ where: { wallet: { companyId: f.ctx.companyId } }, orderBy: { id: 'asc' } })).toEqual(before.ledger)
  })

  it('leaves an undelivered marker retryable when there is no ACTIVE OWNER', async () => {
    const f = await paidCompany()
    await moveSegment(f.subscription, new Date(NOW.getTime() + 4 * DAY))
    await testDb.user.update({ where: { id: f.ctx.userId }, data: { status: 'SUSPENDED' } })
    await runExpireSubscriptions()
    expect(await reminders()).toHaveLength(0)
    await testDb.user.update({ where: { id: f.ctx.userId }, data: { status: 'ACTIVE' } })
    await runExpireSubscriptions()
    expect(await reminders(f.ctx.userId)).toHaveLength(1)
  })

  it('resolves the current OWNER at dispatch time rather than the historical payer', async () => {
    const f = await paidCompany()
    await moveSegment(f.subscription, new Date(NOW.getTime() + 4 * DAY))
    const replacement = await createEmployerWithoutCompany(testDb)
    await testDb.companyMember.update({ where: { userId: f.ctx.userId }, data: { role: 'RECRUITER' } })
    await testDb.companyMember.create({ data: { userId: replacement.userId, companyId: f.ctx.companyId, role: 'OWNER' } })
    await runExpireSubscriptions()
    expect(await reminders(f.ctx.userId)).toHaveLength(0)
    expect(await reminders(replacement.userId)).toHaveLength(1)
  })

  it('rolls back failed reminder delivery while continuing other companies and retrying only undelivered targets', async () => {
    const bad = await paidCompany()
    const good = await paidCompany()
    await moveSegment(bad.subscription, new Date(NOW.getTime() + 5 * DAY))
    await moveSegment(good.subscription, new Date(NOW.getTime() + 5 * DAY))
    const before = await testDb.subscription.findUniqueOrThrow({ where: { id: bad.subscription.id } })
    faults.userId = bad.ctx.userId
    await expect(runExpireSubscriptions()).rejects.toThrow()
    expect(await reminders(bad.ctx.userId)).toHaveLength(0)
    expect(await testDb.subscription.findUnique({ where: { id: bad.subscription.id } })).toEqual(before)
    expect(await reminders(good.ctx.userId)).toHaveLength(1)
    faults.userId = null
    await runExpireSubscriptions()
    expect(await reminders(bad.ctx.userId)).toHaveLength(1)
    expect(await reminders(good.ctx.userId)).toHaveLength(1)
  })
})
