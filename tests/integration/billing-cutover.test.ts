/**
 * M8-T06 rehearsal. Real guarded DB, settings, approval, credits and
 * bank settlement; only external storage/mail/log outputs are isolated.
 * Run with the shared test DB held alone.
 */
import { Prisma } from '@prisma/client'
import { lockXact, LOCK_NS } from '@/server/lib/advisory-locks'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ object: vi.fn(), mail: vi.fn(), confirmed: vi.fn() }))
vi.mock('@/server/auth', () => ({ getSession: vi.fn(), auth: {} }))
vi.mock('@/server/db', async () => ({ db: (await import('../setup/db')).testDb }))
vi.mock('@/lib/storage', () => ({ getObjectBytes: mocks.object }))
vi.mock('@/server/services/notify', () => ({ sendNotificationEmail: mocks.mail, notifyOrderConfirmed: mocks.confirmed }))
vi.mock('@/server/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))
vi.mock('@/server/lib/alert', () => ({ alert: vi.fn() }))

import { setupTestDb, testDb } from '../setup/db'
import { createAdmin, createEmployer } from '../factories'
import { billingFixture, foundingOffer, awaitingOrder, setting, PROOF_BYTES } from '../helpers/billing-t02'
import { updateSettingAdmin } from '@/server/services/admin-settings'
import { clearSettingsCache, getSetting } from '@/server/services/settings'
import { approveCompany } from '@/server/services/review-company'
import { createManagedCompany } from '@/server/services/managed-company'
import { adminAdjust, grantPilotCredits, reconcileWallet } from '@/server/services/credits'
import { grantPilotCreditsOnVerification, klMonthStartUtc } from '@/server/services/pilot-credits'
import { runPilotMonthlyCredits } from '@/server/jobs/pilot-monthly-credits'
import { confirmBankOrder, getMyOrder, quoteOrder } from '@/server/services/billing'

setupTestDb()
beforeEach(() => {
  clearSettingsCache()
  mocks.object.mockReset().mockResolvedValue(PROOF_BYTES)
  mocks.mail.mockReset().mockResolvedValue(undefined)
  mocks.confirmed.mockReset().mockResolvedValue(undefined)
  // Date only: Prisma, locks and I/O timers remain real.
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-01-15T00:00:00.000Z'))
})
afterEach(() => { vi.useRealTimers(); clearSettingsCache() })

async function approve(adminCtx: { userId: string }, owner: { userId: string; companyId: string }) {
  await testDb.company.update({ where: { id: owner.companyId }, data: { verificationStatus: 'PENDING' } })
  const verification = await testDb.companyVerification.create({ data: {
    companyId: owner.companyId, submittedById: owner.userId, status: 'PENDING',
    documentKeys: ['verifications/' + owner.companyId + '/synthetic.pdf'],
  } })
  await approveCompany(adminCtx, {
    verificationId: verification.id, verifiedChannels: ['SSM'], verificationResult: 'Synthetic cutover review',
  })
}
async function money(companyId: string) {
  return {
    wallet: await testDb.creditWallet.findUnique({ where: { companyId }, select: { id: true, balance: true } }),
    ledger: await testDb.creditLedger.findMany({ where: { wallet: { companyId } }, orderBy: { id: 'asc' }, select: { id: true, delta: true, balanceAfter: true, reason: true, refType: true, refId: true } }),
  }
}
async function noPilot(companyId: string) {
  expect(await testDb.creditLedger.count({ where: { wallet: { companyId }, reason: 'PILOT_GRANT' } })).toBe(0)
  expect(await testDb.creditWallet.findUnique({ where: { companyId }, select: { balance: true } })).toEqual({ balance: 0 })
}

describe('M8-T06 pilot-to-paid rehearsal', () => {
  it('preserves an existing wallet and stops initial/monthly grants after the real admin setting change', async () => {
    const admin = await createAdmin(testDb)
    const adminCtx = { userId: admin.userId }
    await updateSettingAdmin(adminCtx, 'billing.enabled', false)
    await updateSettingAdmin(adminCtx, 'billing.studentEnabled', false)
    await updateSettingAdmin(adminCtx, 'pilot.monthlyCredits', 30)
    const oldOwner = await createEmployer(testDb)
    await approve(adminCtx, oldOwner)
    expect((await money(oldOwner.companyId)).wallet?.balance).toBe(30)
    // A genuine audited adjustment supplies a non-round legacy balance, never a raw wallet write.
    await adminAdjust({ actorId: admin.userId }, { companyId: oldOwner.companyId, delta: -7, note: 'Synthetic rehearsal balance adjustment' })
    const before = await money(oldOwner.companyId)
    expect(before.wallet?.balance).toBe(23)
    await updateSettingAdmin(adminCtx, 'billing.enabled', true)
    expect(await money(oldOwner.companyId)).toEqual(before)
    const newOwner = await createEmployer(testDb)
    await approve(adminCtx, newOwner)
    await noPilot(newOwner.companyId)
    // Cross the KL month so an existing monthly marker cannot hide an erroneous grant.
    vi.setSystemTime(new Date('2026-01-31T16:00:00.000Z'))
    await runPilotMonthlyCredits()
    await grantPilotCreditsOnVerification(oldOwner.companyId)
    expect(await money(oldOwner.companyId)).toEqual(before)
    await noPilot(newOwner.companyId)
    expect(await reconcileWallet({ companyId: oldOwner.companyId })).toMatchObject({ ok: true, actual: 23, expected: 23 })
    expect(await getSetting('billing.studentEnabled', true, { fresh: true })).toBe(false)
    expect(await testDb.auditLog.count({ where: { actorId: admin.userId, action: 'setting.update', targetId: 'billing.enabled' } })).toBe(2)
  })

  it.each(['verification', 'monthly'] as const)('observes another process enabling sales despite a warm false cache: %s', async (entry) => {
    const admin = await createAdmin(testDb)
    const adminCtx = { userId: admin.userId }
    await updateSettingAdmin(adminCtx, 'billing.enabled', true)
    const owner = await createEmployer(testDb)
    await approve(adminCtx, owner)
    await noPilot(owner.companyId)
    await updateSettingAdmin(adminCtx, 'billing.enabled', false)
    expect(await getSetting('billing.enabled', true)).toBe(false)
    // The shared helper updates authoritative DB state without invalidating this
    // process's map, modeling a setting write by the web process while worker is warm.
    await setting('billing.enabled', true)
    if (entry === 'verification') await grantPilotCreditsOnVerification(owner.companyId)
    else await runPilotMonthlyCredits()
    await noPilot(owner.companyId)
  })

  it('does not grant to a monthly candidate selected before billing was enabled', async () => {
    const admin = await createAdmin(testDb)
    const adminCtx = { userId: admin.userId }
    await updateSettingAdmin(adminCtx, 'billing.enabled', true)
    const owner = await createEmployer(testDb)
    await approve(adminCtx, owner)
    await updateSettingAdmin(adminCtx, 'billing.enabled', false)
    const selectedMonth = klMonthStartUtc()
    await updateSettingAdmin(adminCtx, 'billing.enabled', true)
    // Shared atomic grant is the final financial boundary. The job's earlier
    // eligibility read cannot authorize a grant after a completed setting switch.
    await grantPilotCredits(owner.companyId, 30, selectedMonth)
    await noPilot(owner.companyId)
    expect(await reconcileWallet({ companyId: owner.companyId })).toMatchObject({ ok: true, actual: 0, expected: 0 })
  })

  it('keeps the real managed-company initial grant path off after cutover', async () => {
    const admin = await createAdmin(testDb)
    await updateSettingAdmin({ userId: admin.userId }, 'billing.enabled', false)
    await updateSettingAdmin({ userId: admin.userId }, 'billing.enabled', true)
    const company = await createManagedCompany({ userId: admin.userId }, {
      legalName: 'SYNTHETIC CUTOVER MANAGED COMPANY', website: 'https://synthetic.example.test',
    })
    expect(company).toMatchObject({ isManaged: true, verificationStatus: 'VERIFIED' })
    await noPilot(company.id)
  })

  it('retains old credits, uses one reviewed annual half-price offer and fulfils the pending order after sales close', async () => {
    const f = await billingFixture('PLAN', 299901)
    await updateSettingAdmin(f.adminCtx, 'billing.enabled', false)
    await approve(f.adminCtx, f.ctx)
    await adminAdjust({ actorId: f.adminCtx.userId }, { companyId: f.ctx.companyId, delta: -7, note: 'Synthetic pre-cutover balance' })
    await foundingOffer(f)
    await expect(quoteOrder(f.ctx, { planId: f.plan.id })).rejects.toMatchObject({ code: 'FEATURE_DISABLED' })
    await updateSettingAdmin(f.adminCtx, 'billing.enabled', true)
    const badgeOnly = await createEmployer(testDb)
    await testDb.company.update({ where: { id: badgeOnly.companyId }, data: { isFoundingPartner: true } })
    const otherQuote = await quoteOrder({ ...badgeOnly, role: 'OWNER' }, { planId: f.plan.id })
    expect(otherQuote.money).toEqual({ currency: 'MYR', listPriceSen: 299901, discountSen: 0, payableSen: 299901 })
    const order = await awaitingOrder(f)
    expect(order).toMatchObject({ status: 'AWAITING_CONFIRMATION', amountSen: 149951, discountSen: 149950 })
    await updateSettingAdmin(f.adminCtx, 'billing.enabled', false)
    await expect(quoteOrder(f.ctx, { planId: f.plan.id })).rejects.toMatchObject({ code: 'FEATURE_DISABLED' })
    await confirmBankOrder(f.adminCtx, { orderId: order.id, receivedAmountSen: 149951, note: 'Synthetic received amount checked after sales closure' })
    expect(await getMyOrder(f.ctx, { orderId: order.id })).toMatchObject({ status: 'PAID', amountSen: 149951, discountSen: 149950 })
    expect((await money(f.ctx.companyId)).wallet?.balance).toBe(143)
    expect(await testDb.creditLedger.count({ where: { refType: 'Order', refId: order.id } })).toBe(1)
    expect(await testDb.subscription.count({ where: { orderId: order.id } })).toBe(1)
    expect(await reconcileWallet({ companyId: f.ctx.companyId })).toMatchObject({ ok: true, actual: 143, expected: 143 })
    await updateSettingAdmin(f.adminCtx, 'billing.enabled', true)
    const renewal = await quoteOrder(f.ctx, { planId: f.plan.id })
    expect(renewal.money).toEqual({ currency: 'MYR', listPriceSen: 299901, discountSen: 0, payableSen: 299901 })
    expect(renewal.promotion).toBeNull()
    expect(await getSetting('billing.studentEnabled', true, { fresh: true })).toBe(false)
  })
})

it('checks committed billing state after a real wait on the company CREDIT lock', async () => {
  const admin = await createAdmin(testDb)
  const adminCtx = { userId: admin.userId }
  await updateSettingAdmin(adminCtx, 'billing.enabled', true)
  const owner = await createEmployer(testDb)
  await approve(adminCtx, owner)
  await adminAdjust({ actorId: admin.userId }, {
    companyId: owner.companyId, delta: 23, note: 'Synthetic balance before CREDIT lock cutover',
  })
  await updateSettingAdmin(adminCtx, 'billing.enabled', false)
  expect(await getSetting('billing.enabled', true)).toBe(false)
  const selectedMonth = klMonthStartUtc()
  const before = await money(owner.companyId)
  expect(before.wallet?.balance).toBe(23)
  // The existing month must be unprocessed, or idempotency could hide a bad guard.
  expect(await testDb.creditLedger.count({
    where: { wallet: { companyId: owner.companyId }, refType: 'PilotPeriod' },
  })).toBe(0)

  let release!: () => void
  let ready!: () => void
  const held = new Promise<void>((resolve) => { release = resolve })
  const acquired = new Promise<void>((resolve) => { ready = resolve })
  const holder = testDb.$transaction(async (tx) => {
    await lockXact(tx, LOCK_NS.CREDIT, owner.companyId)
    ready()
    await held
  }, { maxWait: 2000, timeout: 15000 })
  // Observe both promises immediately; re-await originals after cleanup below
  // so errors still fail the test without becoming unhandled rejections.
  void holder.catch(() => undefined)
  let grant: ReturnType<typeof grantPilotCredits> | undefined
  try {
    await Promise.race([
      acquired,
      holder.then(() => { throw new Error('CREDIT lock holder exited before release') }),
    ])
    grant = grantPilotCredits(owner.companyId, 30, selectedMonth)
    void grant.catch(() => undefined)

    await expect.poll(async () => {
      const [row] = await testDb.$queryRaw<Array<{ waiting: number }>>(Prisma.sql`
        SELECT count(*)::int AS waiting FROM pg_locks
        WHERE locktype = 'advisory' AND NOT granted
          AND database = (SELECT oid FROM pg_database WHERE datname = current_database())
          AND classid = ${LOCK_NS.CREDIT}::oid
          AND objid = hashtext(${owner.companyId})::oid
          AND objsubid = 2
      `)
      return row?.waiting ?? 0
    }, { timeout: 3000, interval: 20 }).toBeGreaterThan(0)

    // The grant is now demonstrably waiting, not merely scheduled. Commit the
    // real audited admin switch before allowing it to acquire CREDIT.
    await updateSettingAdmin(adminCtx, 'billing.enabled', true)
    expect(await getSetting('billing.enabled', false, { fresh: true })).toBe(true)
    expect(await money(owner.companyId)).toEqual(before)
  } finally {
    release()
    // allSettled waits for BOTH transactions even if either rejected. It also
    // preserves any earlier polling/assertion/admin error instead of masking it.
    await Promise.allSettled(grant ? [holder, grant] : [holder])
  }

  await holder
  if (!grant) throw new Error('The real grant operation was not started')
  const result = await grant
  expect(await money(owner.companyId)).toEqual(before)
  expect(await testDb.creditLedger.count({
    where: { wallet: { companyId: owner.companyId }, refType: 'PilotPeriod' },
  })).toBe(0)
  expect(result).toMatchObject({ granted: 0 })
}, 20000)

it('bypasses a warm false cache at the final grant entry point after another process enables billing', async () => {
  const admin = await createAdmin(testDb)
  const adminCtx = { userId: admin.userId }
  await updateSettingAdmin(adminCtx, 'billing.enabled', true)
  const owner = await createEmployer(testDb)
  await approve(adminCtx, owner)
  await adminAdjust({ actorId: admin.userId }, {
    companyId: owner.companyId, delta: 23, note: 'Synthetic balance before cached cutover',
  })
  await updateSettingAdmin(adminCtx, 'billing.enabled', false)
  expect(await getSetting('billing.enabled', true)).toBe(false)
  const before = await money(owner.companyId)
  expect(before.wallet?.balance).toBe(23)
  expect(await testDb.creditLedger.count({
    where: { wallet: { companyId: owner.companyId }, refType: 'PilotPeriod' },
  })).toBe(0)

  // Existing helper writes authoritative DB state without clearing this
  // process's cache, modeling a completed setting write by another process.
  await setting('billing.enabled', true)
  expect(await getSetting('billing.enabled', false, { fresh: true })).toBe(true)
  // A fresh read deliberately does not refresh the local cached false value.
  expect(await getSetting('billing.enabled', true)).toBe(false)

  const result = await grantPilotCredits(owner.companyId, 30, klMonthStartUtc())
  expect(await money(owner.companyId)).toEqual(before)
  expect(await testDb.creditLedger.count({
    where: { wallet: { companyId: owner.companyId }, refType: 'PilotPeriod' },
  })).toBe(0)
  expect(result).toMatchObject({ granted: 0 })
})

it.each([0, 'false', null])('never grants or records a month marker for malformed billing setting %j', async value => {
  const owner = await createEmployer(testDb)
  await testDb.company.update({ where: { id: owner.companyId }, data: { verificationStatus: 'VERIFIED' } })
  await testDb.creditWallet.create({ data: { companyId: owner.companyId, balance: 0 } })
  await testDb.systemSetting.create({ data: { key: 'billing.enabled', value: value === null ? Prisma.JsonNull : value } })
  const before = await money(owner.companyId)
  await runPilotMonthlyCredits()
  await grantPilotCreditsOnVerification(owner.companyId)
  await grantPilotCredits(owner.companyId, 30, klMonthStartUtc())
  expect(await money(owner.companyId)).toEqual(before)
  expect(await testDb.creditLedger.count({ where: { wallet: { companyId: owner.companyId }, refType: 'PilotPeriod' } })).toBe(0)
  expect(mocks.mail).not.toHaveBeenCalled()
})
