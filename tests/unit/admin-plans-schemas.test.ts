/**
 * M8-T01 contract: @/server/services/admin-plans exports createPlanSchema,
 * updatePlanSchema, deletePlanSchema, listPlansAdminSchema; services are covered
 * separately. Full write input uses existing Plan scalar fields only.
 * Update adds id + expectedUpdatedAt (ISO UTC); code/kind immutability is checked
 * against the stored row by the service. List limit is 1..100.
 * PLAN: explicit null means unlimited; CREDIT_PACK: null means no subscription.
 * Missing/empty limits must never be coerced to null or zero. FREE stays finite.
 */
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/server/db', () => ({ db: {} }))
vi.mock('@/server/auth', () => ({ getSession: vi.fn(), auth: {} }))

import {
  createPlanSchema,
  updatePlanSchema,
  deletePlanSchema,
  listPlansAdminSchema,
} from '@/server/services/admin-plans'

const annual = {
  code: 'STANDARD_Y',
  kind: 'PLAN' as const,
  nameZh: '年度测试套餐',
  nameEn: 'Annual test plan',
  priceSen: 299900,
  credits: 120,
  durationDays: 365,
  jobPostLimit: 10,
  seatLimit: 3,
  invitationQuota: 200,
  isActive: true,
  isPublic: true,
  sortOrder: 0,
}

const pack = {
  ...annual,
  code: 'CREDITS_10',
  kind: 'CREDIT_PACK' as const,
  priceSen: 29900,
  credits: 10,
  durationDays: null,
  jobPostLimit: null,
  seatLimit: null,
  invitationQuota: null,
}

const free = {
  ...annual,
  code: 'FREE',
  priceSen: 0,
  credits: 0,
  durationDays: null,
  jobPostLimit: 2,
  seatLimit: 3,
  invitationQuota: 20,
}

describe('Plan write schemas', () => {
  it('normalizes code and trims both names', () => {
    expect(createPlanSchema.parse({
      ...annual, code: ' standard_y ', nameZh: ' 套餐 ', nameEn: ' Annual ',
    })).toMatchObject({ code: 'STANDARD_Y', nameZh: '套餐', nameEn: 'Annual' })
  })

  it.each([annual, pack, free])('accepts the explicit $code shape', (input) => {
    expect(createPlanSchema.safeParse(input).success).toBe(true)
  })

  it('accepts explicit unlimited annual limits without changing their meaning', () => {
    expect(createPlanSchema.parse({
      ...annual, jobPostLimit: null, seatLimit: null, invitationQuota: null,
    })).toMatchObject({ jobPostLimit: null, seatLimit: null, invitationQuota: null })
  })

  it('preserves finite zero jobs/invitations and a single seat', () => {
    expect(createPlanSchema.parse({
      ...annual, jobPostLimit: 0, invitationQuota: 0, seatLimit: 1,
    })).toMatchObject({ jobPostLimit: 0, invitationQuota: 0, seatLimit: 1 })
  })

  it.each(['jobPostLimit', 'seatLimit', 'invitationQuota', 'durationDays'] as const)(
    'rejects omitted or empty %s rather than inventing an entitlement',
    (field) => {
      const omitted: Record<string, unknown> = { ...annual }
      delete omitted[field]
      expect(createPlanSchema.safeParse(omitted).success).toBe(false)
      expect(createPlanSchema.safeParse({ ...annual, [field]: '' }).success).toBe(false)
    },
  )

  it.each([
    { code: '' }, { code: 'X'.repeat(65) }, { code: 'BAD-CODE' }, { code: '中文' },
    { nameZh: '   ' }, { nameEn: '   ' },
    { nameZh: 'x'.repeat(101) }, { nameEn: 'x'.repeat(101) },
    { kind: 'STUDENT_VIEW_PACK' }, { priceSen: 0 }, { priceSen: -1 },
    { priceSen: 1.5 }, { priceSen: '299900' }, { priceSen: 2147483648 },
    { priceSen: Number.NaN }, { priceSen: Number.POSITIVE_INFINITY },
    { credits: -1 }, { credits: 0.5 }, { credits: 2147483648 },
    { durationDays: null }, { durationDays: 0 }, { durationDays: 1.5 },
    { durationDays: 2147483648 }, { jobPostLimit: -1 },
    { jobPostLimit: 2147483648 }, { seatLimit: 0 }, { seatLimit: -1 },
    { seatLimit: 2147483648 }, { invitationQuota: -1 },
    { invitationQuota: 2147483648 }, { sortOrder: -1 },
    { sortOrder: 0.5 }, { sortOrder: 2147483648 }, { isActive: 'false' },
  ])('rejects invalid annual input %j', (changes) => {
    expect(createPlanSchema.safeParse({ ...annual, ...changes }).success).toBe(false)
  })

  it.each([
    { credits: 0 }, { priceSen: 0 }, { durationDays: 365 },
    { jobPostLimit: 10 }, { seatLimit: 3 }, { invitationQuota: 200 },
  ])('rejects a credit pack carrying invalid credits or subscription terms %j', (changes) => {
    expect(createPlanSchema.safeParse({ ...pack, ...changes }).success).toBe(false)
  })

  it.each([
    { priceSen: 1 }, { credits: 1 }, { durationDays: 365 },
    { kind: 'CREDIT_PACK' }, { jobPostLimit: null },
    { seatLimit: null }, { invitationQuota: null },
  ])('preserves FREE money and finite-entitlement invariants %j', (changes) => {
    expect(createPlanSchema.safeParse({ ...free, ...changes }).success).toBe(false)
  })

  it('requires a complete update and a real ISO version token', () => {
    const input = { ...annual, id: 'plan-id', expectedUpdatedAt: '2026-11-09T00:00:00.000Z' }
    expect(updatePlanSchema.safeParse(input).success).toBe(true)
    expect(updatePlanSchema.safeParse({ id: 'plan-id', priceSen: 1 }).success).toBe(false)
    expect(updatePlanSchema.safeParse({ ...input, expectedUpdatedAt: '' }).success).toBe(false)
    expect(updatePlanSchema.safeParse({ ...input, expectedUpdatedAt: 'not-a-date' }).success).toBe(false)
    expect(updatePlanSchema.safeParse({ ...input, expectedUpdatedAt: undefined }).success).toBe(false)
    expect(updatePlanSchema.safeParse({ ...input, jobPostLimit: undefined }).success).toBe(false)
    expect(updatePlanSchema.safeParse({ ...input, priceSen: -1 }).success).toBe(false)
  })

  it('validates delete and bounded list inputs', () => {
    expect(deletePlanSchema.safeParse({ id: 'plan-id' }).success).toBe(true)
    expect(deletePlanSchema.safeParse({ id: '' }).success).toBe(false)
    expect(listPlansAdminSchema.safeParse({ limit: 100, active: false }).success).toBe(true)
    expect(listPlansAdminSchema.safeParse({ limit: 0 }).success).toBe(false)
    expect(listPlansAdminSchema.safeParse({ limit: 101 }).success).toBe(false)
  })
})
