import 'server-only'
import { z } from 'zod'
import type { Prisma } from '@prisma/client'
import type { UserCtx } from '../authz'
import { db } from '../db'
import { ForbiddenError, NotFoundError, ValidationError } from '../errors'
import { logAudit } from './audit'
import { invalidateSynonymCache } from './job-search'

export type CursorInput = { cursor?: string; limit?: number }
export type PageResult<T> = { items: T[]; nextCursor: string | null }
export type SynonymRow = { id: string; terms: string[]; active: boolean; updatedAt: Date }

const synonymIdSchema = z.string().trim().min(1).max(128)
const termSchema = z.string().trim().toLowerCase().min(1).max(100)

export const saveSynonymGroupSchema = z.object({
  id: synonymIdSchema.optional(),
  terms: z.array(termSchema)
    .transform((terms) => [...new Set(terms)])
    .pipe(z.array(termSchema).min(2).max(50)),
  active: z.boolean(),
})

export type SynonymInput = z.input<typeof saveSynonymGroupSchema>

export const listSynonymsSchema = z.object({
  cursor: z.string().min(1).max(512).regex(/^[A-Za-z0-9_-]+$/).optional(),
  limit: z.number().int().min(1).max(50).default(25),
})

const synonymCursorSchema = z.object({
  updatedAt: z.iso.datetime(),
  id: synonymIdSchema,
}).strict()

function decodeSynonymCursor(raw: string): z.infer<typeof synonymCursorSchema> {
  try {
    const bytes = Buffer.from(raw, 'base64url')
    if (bytes.toString('base64url') !== raw) throw new ValidationError()
    const parsed = synonymCursorSchema.safeParse(JSON.parse(bytes.toString('utf8')))
    if (parsed.success) return parsed.data
  } catch {
    // Decode and schema errors share a controlled service error.
  }
  throw new ValidationError()
}

async function assertAdmin(ctx: UserCtx, client: Prisma.TransactionClient | typeof db = db): Promise<void> {
  const actor = await client.user.findUnique({
    where: { id: ctx.userId },
    select: { role: true, status: true },
  })
  if (!actor || actor.role !== 'ADMIN' || actor.status !== 'ACTIVE') throw new ForbiddenError()
}

export async function listSynonyms(
  ctx: UserCtx,
  rawInput: CursorInput,
): Promise<PageResult<SynonymRow>> {
  await assertAdmin(ctx)
  const parsed = listSynonymsSchema.safeParse(rawInput)
  if (!parsed.success) throw new ValidationError()
  const input = parsed.data
  const cursor = input.cursor ? decodeSynonymCursor(input.cursor) : undefined
  const rows = await db.searchSynonymGroup.findMany({
    where: cursor ? {
      OR: [
        { updatedAt: { lt: new Date(cursor.updatedAt) } },
        { updatedAt: new Date(cursor.updatedAt), id: { gt: cursor.id } },
      ],
    } : {},
    orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
    take: input.limit + 1,
    select: { id: true, terms: true, active: true, updatedAt: true },
  })
  const items = rows.slice(0, input.limit)
  const last = items.at(-1)
  return {
    items,
    nextCursor: rows.length > input.limit && last
      ? Buffer.from(JSON.stringify({ updatedAt: last.updatedAt.toISOString(), id: last.id })).toString('base64url')
      : null,
  }
}

export async function saveSynonymGroup(
  ctx: UserCtx,
  rawInput: SynonymInput,
): Promise<{ id: string }> {
  const saved = await db.$transaction(async (tx) => {
    await assertAdmin(ctx, tx)
    const parsed = saveSynonymGroupSchema.safeParse(rawInput)
    if (!parsed.success) throw new ValidationError()
    const input = parsed.data
    if (input.id && !await tx.searchSynonymGroup.findUnique({ where: { id: input.id }, select: { id: true } })) {
      throw new NotFoundError()
    }
    const data = { terms: input.terms, active: input.active }
    const result = input.id
      ? await tx.searchSynonymGroup.update({ where: { id: input.id }, data, select: { id: true } })
      : await tx.searchSynonymGroup.create({ data, select: { id: true } })
    await logAudit({
      actorId: ctx.userId,
      action: 'search.synonym.save',
      targetType: 'SearchSynonymGroup',
      targetId: result.id,
      metadata: {
        operation: input.id ? 'update' : 'create',
        active: input.active,
        termCount: input.terms.length,
      },
    }, tx)
    return result
  })
  // A concurrent search must not refill the cache with rows from before this commit.
  invalidateSynonymCache()
  return saved
}
