import 'server-only'
import { z } from 'zod'
import { db } from '../db'
import { ForbiddenError } from '../errors'
import type { UserCtx } from '../authz'

// Keys whose values must always be redacted. Matched anywhere in the key (userEmail, phoneNumber,
// resetToken…), except `code`, which is matched exactly because alert metadata uses `code` for the
// alert name.
const SENSITIVE_KEY_RE = /(phone|email|wechat|whatsapp|otp|token|password|secret)/i
const EXACT_SENSITIVE_KEYS = new Set(['code'])
// String values that look like an email or phone number
const EMAIL_VALUE_RE = /^[^\s@]{1,64}@[^\s@]{1,255}\.[^\s@]{2,}$/
const PHONE_VALUE_RE = /^\+?[0-9][\d\s\-()]{5,19}$/
const MAX_DEPTH = 6

function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEY_RE.test(key) || EXACT_SENSITIVE_KEYS.has(key.toLowerCase())
}

function sanitizeValue(value: unknown, depth: number): unknown {
  if (typeof value === 'string') {
    return EMAIL_VALUE_RE.test(value) || PHONE_VALUE_RE.test(value) ? '***' : value
  }
  if (value === null || typeof value !== 'object') return value
  // Metadata is shallow in practice; anything nested deeper than this is collapsed rather than shown.
  if (depth >= MAX_DEPTH) return '***'
  if (Array.isArray(value)) return value.map((v) => sanitizeValue(v, depth + 1))
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = isSensitiveKey(k) ? '***' : sanitizeValue(v, depth + 1)
  }
  return out
}

/** Redacts PII-like keys and values in metadata, at any nesting depth. Display-layer only. */
export function sanitizeAuditMetadata(
  metadata: Record<string, unknown>,
): Record<string, unknown> {
  return sanitizeValue(metadata, 0) as Record<string, unknown>
}

// KL is UTC+8 year-round (no DST)
function klDateToUtcStart(dateStr: string): Date {
  // dateStr = "YYYY-MM-DD" in KL time → UTC midnight KL = UTC − 8h
  return new Date(new Date(dateStr + 'T00:00:00+08:00').getTime())
}

function klDateToUtcEnd(dateStr: string): Date {
  // End of that KL calendar day
  return new Date(new Date(dateStr + 'T23:59:59.999+08:00').getTime())
}

export interface AuditLogCursor {
  createdAt: string // ISO
  id: string
}

export function encodeCursor(cursor: AuditLogCursor): string {
  return Buffer.from(JSON.stringify(cursor)).toString('base64url')
}

export function decodeCursor(raw: string): AuditLogCursor | null {
  try {
    const obj = JSON.parse(Buffer.from(raw, 'base64url').toString()) as unknown
    if (
      typeof obj === 'object' &&
      obj !== null &&
      'createdAt' in obj &&
      'id' in obj &&
      typeof (obj as AuditLogCursor).createdAt === 'string' &&
      typeof (obj as AuditLogCursor).id === 'string'
    ) {
      return obj as AuditLogCursor
    }
    return null
  } catch {
    return null
  }
}

export const listAuditLogsSchema = z.object({
  action: z.string().max(200).optional(),
  actorId: z.string().optional(),
  actorEmail: z.string().email().max(300).optional(),
  targetType: z.string().max(200).optional(),
  targetId: z.string().max(200).optional(),
  dateFrom: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  dateTo: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  cursor: z.string().max(500).optional(),
})

export type ListAuditLogsInput = z.infer<typeof listAuditLogsSchema>

export interface AuditLogItem {
  id: string
  action: string
  actorId: string | null
  actorName: string | null
  actorEmail: string | null
  actorRole: string | null
  targetType: string
  targetId: string | null
  metadata: Record<string, unknown>
  ip: string | null
  createdAt: Date
}

export interface ListAuditLogsResult {
  items: AuditLogItem[]
  nextCursor: string | null
}

const PAGE_SIZE = 50

async function assertAdmin(ctx: UserCtx): Promise<void> {
  const user = await db.user.findUnique({
    where: { id: ctx.userId },
    select: { role: true, status: true },
  })
  if (!user || user.role !== 'ADMIN' || user.status !== 'ACTIVE') {
    throw new ForbiddenError()
  }
}

export async function listAuditLogs(
  ctx: UserCtx,
  rawInput: ListAuditLogsInput,
): Promise<ListAuditLogsResult> {
  await assertAdmin(ctx)

  const input = listAuditLogsSchema.parse(rawInput)

  // Resolve actorEmail to actorId if provided
  let resolvedActorId = input.actorId
  if (input.actorEmail && !resolvedActorId) {
    const user = await db.user.findFirst({
      where: { email: input.actorEmail },
      select: { id: true },
    })
    if (!user) {
      // No user with that email → no results
      return { items: [], nextCursor: null }
    }
    resolvedActorId = user.id
  }

  // Build createdAt range from KL dates
  const createdAtFilter: { gte?: Date; lte?: Date } = {}
  if (input.dateFrom) createdAtFilter.gte = klDateToUtcStart(input.dateFrom)
  if (input.dateTo) createdAtFilter.lte = klDateToUtcEnd(input.dateTo)

  // Decode cursor
  const cursor = input.cursor ? decodeCursor(input.cursor) : null

  const where = {
    ...(input.action ? { action: input.action } : {}),
    ...(resolvedActorId ? { actorId: resolvedActorId } : {}),
    ...(input.targetType ? { targetType: input.targetType } : {}),
    ...(input.targetId ? { targetId: input.targetId } : {}),
    ...(Object.keys(createdAtFilter).length ? { createdAt: createdAtFilter } : {}),
    // Cursor condition: (createdAt, id) < (cursor.createdAt, cursor.id) for DESC ordering
    ...(cursor
      ? {
          OR: [
            { createdAt: { lt: new Date(cursor.createdAt) } },
            {
              createdAt: new Date(cursor.createdAt),
              id: { lt: cursor.id },
            },
          ],
        }
      : {}),
  }

  const rows = await db.auditLog.findMany({
    where,
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: PAGE_SIZE + 1,
    select: {
      id: true,
      action: true,
      actorId: true,
      targetType: true,
      targetId: true,
      metadata: true,
      ip: true,
      createdAt: true,
    },
  })

  const hasMore = rows.length > PAGE_SIZE
  const pageRows = hasMore ? rows.slice(0, PAGE_SIZE) : rows

  // Fetch actor info for all actorIds in one query
  const actorIds = [...new Set(pageRows.map((r) => r.actorId).filter((id): id is string => id != null))]
  const actors =
    actorIds.length > 0
      ? await db.user.findMany({
          where: { id: { in: actorIds } },
          select: { id: true, name: true, email: true, role: true },
        })
      : []
  const actorMap = new Map(actors.map((a) => [a.id, a]))

  const items: AuditLogItem[] = pageRows.map((row) => {
    const actor = row.actorId ? actorMap.get(row.actorId) : undefined
    const rawMeta =
      row.metadata != null && typeof row.metadata === 'object' && !Array.isArray(row.metadata)
        ? (row.metadata as Record<string, unknown>)
        : {}
    return {
      id: row.id,
      action: row.action,
      actorId: row.actorId,
      actorName: actor?.name ?? null,
      actorEmail: actor?.email ?? null,
      actorRole: actor?.role ?? null,
      targetType: row.targetType,
      targetId: row.targetId,
      metadata: sanitizeAuditMetadata(rawMeta),
      ip: row.ip,
      createdAt: row.createdAt,
    }
  })

  const lastRow = pageRows[pageRows.length - 1]
  const nextCursor =
    hasMore && lastRow
      ? encodeCursor({ createdAt: lastRow.createdAt.toISOString(), id: lastRow.id })
      : null

  return { items, nextCursor }
}

