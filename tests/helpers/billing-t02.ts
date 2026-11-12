import { randomUUID } from 'node:crypto'
import { Prisma } from '@prisma/client'
import type { CompanyCtx } from '@/server/authz'
import { testDb } from '../setup/db'
import { createAdmin, createEmployer } from '../factories'
import { clearSettingsCache } from '@/server/services/settings'
import { quoteOrder, createOrder, attachBankProof } from '@/server/services/billing'

// One valid transparent PNG. No real upload, bank data, account, or payment.
export const PROOF_BYTES = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==',
  'base64',
)
export const BANK_SETTING = 'billing.bankTransfer'
export const SYNTHETIC_BANK = {
  bankName: 'SYNTHETIC TEST BANK',
  accountName: 'SYNTHETIC TEST PAYEE',
  accountNumber: '0000000000',
  instructions: 'TEST ONLY. This is not a payment destination.',
}

export async function setting(key: string, value: Prisma.InputJsonValue) {
  await testDb.systemSetting.upsert({
    where: { key }, create: { key, value }, update: { value },
  })
}

export async function billingFixture(kind: 'PLAN' | 'CREDIT_PACK' = 'PLAN', priceSen = 299900) {
  clearSettingsCache()
  await setting('billing.enabled', true)
  await setting('billing.studentEnabled', false)
  await setting(BANK_SETTING, SYNTHETIC_BANK)
  await setting('billing.foundingOffer', {
    enabled: false, version: 'test-v1', rateBps: 5000,
    eligiblePlanCodes: [], eligibleCompanyIds: [], startsAt: null, endsAt: null,
  })
  const employer = await createEmployer(testDb)
  const admin = await createAdmin(testDb)
  const plan = await testDb.plan.create({
    data: {
      code: 'T02_' + randomUUID().replaceAll('-', '').toUpperCase(),
      kind, nameZh: '合成账单测试套餐', nameEn: 'Synthetic billing test plan',
      priceSen, credits: kind === 'PLAN' ? 120 : 10,
      durationDays: kind === 'PLAN' ? 365 : null,
      jobPostLimit: kind === 'PLAN' ? 10 : null,
      seatLimit: kind === 'PLAN' ? 3 : null,
      invitationQuota: kind === 'PLAN' ? 200 : null,
      isActive: true, isPublic: true,
    },
  })
  const ctx: CompanyCtx = { ...employer, role: 'OWNER' }
  return { ctx, adminCtx: { userId: admin.userId }, plan }
}

export type BillingFixture = Awaited<ReturnType<typeof billingFixture>>

export async function foundingOffer(f: BillingFixture) {
  await testDb.company.update({ where: { id: f.ctx.companyId }, data: { isFoundingPartner: true } })
  await setting('billing.foundingOffer', {
    enabled: true, version: 'test-v1', rateBps: 5000,
    eligiblePlanCodes: [f.plan.code], eligibleCompanyIds: [f.ctx.companyId],
    startsAt: new Date(Date.now() - 86400_000).toISOString(),
    endsAt: new Date(Date.now() + 86400_000).toISOString(),
  })
}

export async function pendingOrder(f: BillingFixture) {
  const acceptedQuote = await quoteOrder(f.ctx, { planId: f.plan.id })
  const result = await createOrder(f.ctx, {
    planId: f.plan.id, method: 'BANK_TRANSFER', acceptedQuote,
  })
  return testDb.order.findUniqueOrThrow({ where: { id: result.orderId } })
}

export async function proofUpload(f: BillingFixture) {
  const storageKey = 'payment_proofs/' + f.ctx.companyId + '/' + randomUUID() + '.png'
  return testDb.paymentProofUpload.create({
    data: {
      companyId: f.ctx.companyId, uploaderId: f.ctx.userId,
      storageKey, mimeType: 'image/png', sizeBytes: PROOF_BYTES.length,
    },
  })
}

export async function awaitingOrder(f: BillingFixture) {
  const order = await pendingOrder(f)
  const proof = await proofUpload(f)
  await attachBankProof(f.ctx, { orderId: order.id, proofKey: proof.storageKey })
  return testDb.order.findUniqueOrThrow({ where: { id: order.id } })
}
