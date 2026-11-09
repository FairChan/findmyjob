import 'server-only'
import { z } from 'zod'
import { Prisma, type Plan } from '@prisma/client'
import type { UserCtx } from '../authz'
import { db } from '../db'
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../errors'
import { logAudit } from './audit'
import { getSetting } from './settings'

const nonnegativeInt = z.number().int().min(0).max(2_147_483_647)
const positiveInt = z.number().int().min(1).max(2_147_483_647)
const planId = z.string().trim().min(1).max(200)

const planWriteSchema = z.object({
  code: z.string().trim().toUpperCase().min(1).max(64).regex(/^[A-Z0-9_]+$/),
  kind: z.enum(['PLAN', 'CREDIT_PACK', 'STUDENT_VIEW_PACK']),
  nameZh: z.string().trim().min(1).max(100),
  nameEn: z.string().trim().min(1).max(100),
  priceSen: nonnegativeInt,
  credits: nonnegativeInt,
  durationDays: positiveInt.nullable(),
  jobPostLimit: nonnegativeInt.nullable(),
  seatLimit: positiveInt.nullable(),
  invitationQuota: nonnegativeInt.nullable(),
  isActive: z.boolean(),
  isPublic: z.boolean(),
  sortOrder: nonnegativeInt,
})

function validatePlanTerms(plan: z.infer<typeof planWriteSchema>, ctx: z.RefinementCtx): void {
  const reject = (field: keyof typeof plan, message: string) => {
    ctx.addIssue({ code: 'custom', path: [field], message })
  }

  if (plan.kind === 'STUDENT_VIEW_PACK') reject('kind', 'Student products are not enabled')
  if (plan.code === 'FREE') {
    if (plan.kind !== 'PLAN') reject('kind', 'FREE must be a plan')
    if (plan.priceSen !== 0) reject('priceSen', 'FREE must have zero price')
    if (plan.credits !== 0) reject('credits', 'FREE cannot grant purchased credits')
    if (plan.durationDays !== null) reject('durationDays', 'FREE has no subscription duration')
    if (!plan.isActive) reject('isActive', 'FREE cannot be deactivated')
    for (const field of ['jobPostLimit', 'seatLimit', 'invitationQuota'] as const) {
      if (plan[field] === null) reject(field, 'FREE must have a finite entitlement')
    }
    return
  }

  if (plan.priceSen === 0) reject('priceSen', 'Paid products must have a positive price')
  if (plan.kind === 'PLAN' && plan.durationDays === null) {
    reject('durationDays', 'Paid plans require a positive duration')
  }
  if (plan.kind === 'CREDIT_PACK') {
    if (plan.credits === 0) reject('credits', 'Credit packs must grant credits')
    for (const field of ['durationDays', 'jobPostLimit', 'seatLimit', 'invitationQuota'] as const) {
      if (plan[field] !== null) reject(field, 'Credit packs cannot include subscription terms')
    }
  }
}

export const createPlanSchema = planWriteSchema.superRefine(validatePlanTerms)
export const updatePlanSchema = planWriteSchema.extend({
  id: planId,
  expectedUpdatedAt: z.iso.datetime({ precision: 3 }),
}).superRefine(validatePlanTerms)

export const deletePlanSchema = z.object({ id: planId })

export const listPlansAdminSchema = z.object({
  cursor: z.string().min(1).max(500).optional(),
  limit: z.number().int().min(1).max(100).optional(),
  active: z.boolean().optional(),
})

export type PlanWriteInput = z.infer<typeof createPlanSchema>
export type PlanUpdateInput = z.infer<typeof updatePlanSchema>
export type PlanDeleteInput = z.infer<typeof deletePlanSchema>
export type ListPlansAdminInput = z.infer<typeof listPlansAdminSchema>

// Service rows retain Date values and every existing Plan scalar, including
// reserved kinds. Client forms must use type-only imports from this module.
export type AdminPlanRow = Plan
export type AdminPlanClientRow = Omit<AdminPlanRow, 'createdAt' | 'updatedAt'> & {
  createdAt: string
  updatedAt: string
}

export type PublicPlanRow = Pick<
  Plan,
  | 'id'
  | 'code'
  | 'nameZh'
  | 'nameEn'
  | 'priceSen'
  | 'credits'
  | 'durationDays'
  | 'jobPostLimit'
  | 'seatLimit'
  | 'invitationQuota'
  | 'sortOrder'
> & { kind: 'PLAN' | 'CREDIT_PACK' }

export interface AdminPlanPage {
  items: AdminPlanRow[]
  nextCursor: string | null
}

export interface PublicPlansResult {
  billingEnabled: boolean
  items: PublicPlanRow[]
}

async function assertAdmin(userId: string, client: Prisma.TransactionClient = db): Promise<void> {
  const user = await client.user.findUnique({
    where: { id: userId },
    select: { role: true, status: true },
  })
  if (!user || user.role !== 'ADMIN' || user.status !== 'ACTIVE') throw new ForbiddenError()
}

const cursorSchema = z.object({ sortOrder: nonnegativeInt, id: planId })

function decodeCursor(raw: string): z.infer<typeof cursorSchema> {
  try {
    return cursorSchema.parse(JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')))
  } catch {
    throw new ValidationError('Invalid plan cursor')
  }
}

// Record explicit finite/unlimited choices, but never copy arbitrary product names.
function auditTerms(plan: PlanWriteInput) {
  return {
    kind: plan.kind,
    priceSen: plan.priceSen,
    credits: plan.credits,
    durationDays: plan.durationDays,
    jobPostLimit: plan.jobPostLimit,
    seatLimit: plan.seatLimit,
    invitationQuota: plan.invitationQuota,
    isActive: plan.isActive,
    isPublic: plan.isPublic,
    sortOrder: plan.sortOrder,
  }
}

export async function listPlansAdmin(
  ctx: UserCtx,
  input: ListPlansAdminInput,
): Promise<AdminPlanPage> {
  await assertAdmin(ctx.userId)
  const { cursor: rawCursor, limit = 25, active } = listPlansAdminSchema.parse(input)
  const cursor = rawCursor ? decodeCursor(rawCursor) : null
  const rows = await db.plan.findMany({
    where: {
      ...(active !== undefined ? { isActive: active } : {}),
      ...(cursor ? {
        OR: [
          { sortOrder: { gt: cursor.sortOrder } },
          { sortOrder: cursor.sortOrder, id: { gt: cursor.id } },
        ],
      } : {}),
    },
    orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
    take: limit + 1,
  })
  const items = rows.slice(0, limit)
  const last = items.at(-1)
  return {
    items,
    nextCursor: rows.length > limit && last
      ? Buffer.from(JSON.stringify({ sortOrder: last.sortOrder, id: last.id })).toString('base64url')
      : null,
  }
}

export async function createPlan(
  ctx: UserCtx,
  input: PlanWriteInput,
): Promise<{ id: string }> {
  return db.$transaction(async (tx) => {
    await assertAdmin(ctx.userId, tx)
    const data = createPlanSchema.parse(input)
    let plan: Plan
    try {
      plan = await tx.plan.create({ data })
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictError('A plan with this code already exists')
      }
      throw error
    }
    await logAudit({
      actorId: ctx.userId,
      action: 'plan.create',
      targetType: 'Plan',
      targetId: plan.id,
      metadata: { to: auditTerms(data) },
    }, tx)
    return { id: plan.id }
  })
}

export async function updatePlan(
  ctx: UserCtx,
  input: PlanUpdateInput,
): Promise<{ id: string }> {
  return db.$transaction(async (tx) => {
    await assertAdmin(ctx.userId, tx)
    const { id, expectedUpdatedAt, ...data } = updatePlanSchema.parse(input)
    const existing = await tx.plan.findUnique({ where: { id } })
    if (!existing) throw new NotFoundError('Plan not found')
    if (data.code !== existing.code || data.kind !== existing.kind) {
      throw new ValidationError('Plan code and kind cannot be changed')
    }
    const expected = new Date(expectedUpdatedAt)
    if (existing.updatedAt.getTime() !== expected.getTime()) {
      throw new ConflictError('Plan changed; reload before editing')
    }
    // @updatedAt alone can repeat within the same millisecond. The CAS token
    // must advance even when the clock has not advanced (or moved backwards).
    const updatedAt = new Date(Math.max(Date.now(), existing.updatedAt.getTime() + 1))
    const result = await tx.plan.updateMany({
      where: { id, updatedAt: expected },
      data: { ...data, updatedAt },
    })
    if (result.count !== 1) throw new ConflictError('Plan changed; reload before editing')
    await logAudit({
      actorId: ctx.userId,
      action: existing.isActive && !data.isActive ? 'plan.deactivate' : 'plan.update',
      targetType: 'Plan',
      targetId: id,
      metadata: { from: auditTerms(existing), to: auditTerms(data) },
    }, tx)
    return { id }
  })
}

export async function deletePlan(
  ctx: UserCtx,
  input: PlanDeleteInput,
): Promise<void> {
  await db.$transaction(async (tx) => {
    await assertAdmin(ctx.userId, tx)
    const { id } = deletePlanSchema.parse(input)
    const existing = await tx.plan.findUnique({
      where: { id },
      include: { _count: { select: { orders: true, subscriptions: true } } },
    })
    if (!existing) throw new NotFoundError('Plan not found')
    if (existing.code === 'FREE') throw new ConflictError('FREE cannot be deleted')
    if (existing._count.orders > 0 || existing._count.subscriptions > 0) {
      throw new ConflictError('Referenced plans must be deactivated instead of deleted')
    }
    try {
      // Required relation FKs also reject an Order/Subscription inserted after
      // the reference check; neither history nor its planId is ever rewritten.
      await tx.plan.delete({ where: { id } })
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (error.code === 'P2003') {
          throw new ConflictError('Referenced plans must be deactivated instead of deleted')
        }
        if (error.code === 'P2025') throw new NotFoundError('Plan not found')
      }
      throw error
    }
    await logAudit({
      actorId: ctx.userId,
      action: 'plan.delete',
      targetType: 'Plan',
      targetId: id,
      metadata: { from: auditTerms(existing) },
    }, tx)
  })
}

export async function listPublicPlans(): Promise<PublicPlansResult> {
  const billingEnabled = await getSetting<unknown>('billing.enabled', false) === true
  const rows = await db.plan.findMany({
    where: {
      isActive: true,
      isPublic: true,
      kind: { in: ['PLAN', 'CREDIT_PACK'] },
      ...(!billingEnabled ? { code: 'FREE' } : {}),
    },
    orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
    take: 100,
    select: {
      id: true,
      code: true,
      kind: true,
      nameZh: true,
      nameEn: true,
      priceSen: true,
      credits: true,
      durationDays: true,
      jobPostLimit: true,
      seatLimit: true,
      invitationQuota: true,
      sortOrder: true,
    },
  })
  return {
    billingEnabled,
    items: rows.filter((row): row is PublicPlanRow => row.kind === 'PLAN' || row.kind === 'CREDIT_PACK'),
  }
}
