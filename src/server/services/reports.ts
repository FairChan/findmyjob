import 'server-only'
import { z } from 'zod'
import type { JobReportReason, Prisma, ReportStatus } from '@prisma/client'
import type { UserCtx } from '../authz'
import { db } from '../db'
import { ConflictError, ForbiddenError, NotFoundError, RateLimitedError, ValidationError } from '../errors'
import { lockXact, LOCK_NS } from '../lib/advisory-locks'
import { logger } from '../lib/logger'
import { logAudit } from './audit'
import { notifyNewReport } from './notify'
import { getSetting } from './settings'

const idSchema = z.string().trim().min(1).max(128)
const reportCursorSchema = z.object({
  createdAt: z.string().datetime(),
  id: idSchema,
}).strict()

function decodeReportCursor(raw: string): z.infer<typeof reportCursorSchema> | null {
  try {
    if (!/^[A-Za-z0-9_-]+$/.test(raw)) return null
    const json = Buffer.from(raw, 'base64url').toString('utf8')
    const parsed = reportCursorSchema.safeParse(JSON.parse(json) as unknown)
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

export const createReportSchema = z.object({
  jobId: idSchema,
  reason: z.enum(['ASKS_PAYMENT', 'FAKE_SALARY', 'ILLEGAL_WORK', 'MISMATCH', 'OTHER']),
  note: z.string().trim().max(1000).optional(),
})

export const resolveReportSchema = z.object({
  reportId: idSchema,
  status: z.enum(['RESOLVED', 'DISMISSED']),
})

export const listReportsSchema = z.object({
  cursor: z.string().trim().min(1).max(1024)
    .refine((value) => decodeReportCursor(value) !== null, 'Invalid cursor').optional(),
  limit: z.number().int().min(1).max(50).default(25),
  status: z.enum(['OPEN', 'RESOLVED', 'DISMISSED']).optional(),
  jobId: idSchema.optional(),
})

export type CreateReportInput = z.input<typeof createReportSchema>
export type ResolveReportInput = z.input<typeof resolveReportSchema>
export type ListReportsInput = z.input<typeof listReportsSchema>
export type AdminReportRow = {
  id: string
  jobId: string
  jobTitle: string
  companyName: string
  reporterId: string
  reason: JobReportReason
  note: string | null
  status: ReportStatus
  resolverId: string | null
  resolvedAt: Date | null
  createdAt: Date
}

function parseInput<T extends z.ZodType>(schema: T, raw: unknown): z.output<T> {
  const parsed = schema.safeParse(raw)
  if (!parsed.success) {
    throw new ValidationError(parsed.error.issues[0]?.message ?? 'Invalid input')
  }
  return parsed.data
}

async function assertActor(
  client: Prisma.TransactionClient,
  userId: string,
  adminOnly: boolean,
): Promise<void> {
  const actor = await client.user.findUnique({
    where: { id: userId }, select: { role: true, status: true },
  })
  if (!actor || actor.status !== 'ACTIVE' || (adminOnly && actor.role !== 'ADMIN')) {
    throw new ForbiddenError()
  }
}

async function getDailyReportLimit(): Promise<number> {
  const key = 'limits.jobReportsPerDay'
  const raw = await getSetting<unknown>(key, 10)
  const parsed = z.number().int().min(1).max(1000).safeParse(raw)
  if (parsed.success) return parsed.data
  // Invalid historic settings can contain arbitrary text: do not log the value.
  logger.warn({ key, defaultValue: 10 }, 'Invalid report allowance; using default')
  return 10
}

export async function createReport(
  ctx: UserCtx,
  rawInput: CreateReportInput,
): Promise<{ reportId: string }> {
  const input = parseInput(createReportSchema, rawInput)
  const dailyLimit = await getDailyReportLimit()
  const report = await db.$transaction(async (tx) => {
    await assertActor(tx, ctx.userId, false)
    await lockXact(tx, LOCK_NS.JOB_REPORT, ctx.userId)
    // A queued request uses the day observed after acquiring the allowance lock.
    const now = new Date()
    const job = await tx.job.findFirst({
      where: {
        id: input.jobId,
        status: 'PUBLISHED',
        company: { isActive: true },
        OR: [{ deadline: null }, { deadline: { gt: now } }],
      },
      select: { id: true },
    })
    if (!job) throw new NotFoundError()

    // Kuala Lumpur is UTC+8 year-round. Count every status in [start, next start).
    const dayMs = 86_400_000
    const offsetMs = 8 * 60 * 60 * 1000
    const startMs = Math.floor((now.getTime() + offsetMs) / dayMs) * dayMs - offsetMs
    const submitted = await tx.jobReport.count({
      where: {
        reporterId: ctx.userId,
        createdAt: { gte: new Date(startMs), lt: new Date(startMs + dayMs) },
      },
    })
    if (submitted >= dailyLimit) throw new RateLimitedError()
    return tx.jobReport.create({
      data: {
        jobId: job.id,
        reporterId: ctx.userId,
        reason: input.reason,
        note: input.note || null,
        createdAt: now,
      },
      select: { id: true },
    })
  })

  // The complete helper (including recipient lookup) is best effort and post-commit.
  try {
    await notifyNewReport(report.id)
  } catch {
    logger.error({ reportId: report.id }, 'Failed to send report.new notification')
  }
  return { reportId: report.id }
}

export async function listReports(
  ctx: UserCtx,
  rawInput: ListReportsInput = {},
): Promise<{ items: AdminReportRow[]; nextCursor: string | null }> {
  await assertActor(db, ctx.userId, true)
  const input = parseInput(listReportsSchema, rawInput)
  const cursor = input.cursor ? decodeReportCursor(input.cursor) : null
  const rows = await db.jobReport.findMany({
    where: {
      ...(input.status ? { status: input.status } : {}),
      ...(input.jobId ? { jobId: input.jobId } : {}),
      ...(cursor ? {
        OR: [
          { createdAt: { lt: new Date(cursor.createdAt) } },
          { createdAt: new Date(cursor.createdAt), id: { lt: cursor.id } },
        ],
      } : {}),
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: input.limit + 1,
    select: {
      id: true, jobId: true, reporterId: true, reason: true, note: true,
      status: true, resolverId: true, resolvedAt: true, createdAt: true,
      job: { select: { title: true, company: { select: { legalName: true } } } },
    },
  })
  const page = rows.slice(0, input.limit)
  const last = page.at(-1)
  const nextCursor = rows.length > input.limit && last
    ? Buffer.from(JSON.stringify({ createdAt: last.createdAt.toISOString(), id: last.id })).toString('base64url')
    : null
  return {
    items: page.map(({ job, ...row }) => ({
      ...row, jobTitle: job.title, companyName: job.company.legalName,
    })),
    nextCursor,
  }
}

export async function resolveReport(
  ctx: UserCtx,
  rawInput: ResolveReportInput,
): Promise<{ reportId: string; status: 'RESOLVED' | 'DISMISSED' }> {
  const input = parseInput(resolveReportSchema, rawInput)
  return db.$transaction(async (tx) => {
    await assertActor(tx, ctx.userId, true)
    // PostgreSQL's conditional UPDATE serializes competing decisions on this row.
    const updated = await tx.jobReport.updateMany({
      where: { id: input.reportId, status: 'OPEN' },
      data: { status: input.status, resolverId: ctx.userId, resolvedAt: new Date() },
    })
    const report = await tx.jobReport.findUnique({
      where: { id: input.reportId }, select: { jobId: true, status: true },
    })
    if (!report) throw new NotFoundError()
    if (updated.count === 0) {
      if (report.status !== input.status) throw new ConflictError()
      return { reportId: input.reportId, status: input.status }
    }
    await logAudit({
      actorId: ctx.userId,
      action: 'job.report.resolve',
      targetType: 'JobReport',
      targetId: input.reportId,
      metadata: { jobId: report.jobId, fromStatus: 'OPEN', toStatus: input.status },
    }, tx)
    return { reportId: input.reportId, status: input.status }
  })
}
