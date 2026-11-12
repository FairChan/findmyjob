import type { Prisma, PrismaClient } from '@prisma/client'

// Business plan §5.3 placeholders. Re-running seed must preserve operator edits.
const plans: Prisma.PlanCreateInput[] = [
  {
    code: 'FREE', kind: 'PLAN', nameZh: '免费方案', nameEn: 'Free',
    priceSen: 0, credits: 0, durationDays: null,
    jobPostLimit: 2, seatLimit: 3, invitationQuota: 20,
    isActive: true, isPublic: true, sortOrder: 0,
  },
  {
    code: 'CREDITS_10', kind: 'CREDIT_PACK', nameZh: '10 点点数包', nameEn: '10 credits',
    priceSen: 29900, credits: 10, durationDays: null,
    jobPostLimit: null, seatLimit: null, invitationQuota: null,
    isActive: true, isPublic: true, sortOrder: 10,
  },
  {
    code: 'STANDARD_Y', kind: 'PLAN', nameZh: '标准年费方案', nameEn: 'Standard annual',
    priceSen: 299900, credits: 120, durationDays: 365,
    jobPostLimit: 10, seatLimit: 3, invitationQuota: 200,
    isActive: true, isPublic: true, sortOrder: 20,
  },
  {
    code: 'PARTNER_Y', kind: 'PLAN', nameZh: '合作伙伴年费方案', nameEn: 'Partner annual',
    priceSen: 888800, credits: 400, durationDays: 365,
    jobPostLimit: null, seatLimit: 10, invitationQuota: 200,
    isActive: true, isPublic: true, sortOrder: 30,
  },
]

export async function seedPlans(db: PrismaClient): Promise<void> {
  await db.$transaction(plans.map(plan => db.plan.upsert({
    where: { code: plan.code }, create: plan, update: {},
  })))
}
