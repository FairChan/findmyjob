import 'server-only'
import { z } from 'zod'
import type { ArticleCategory, Prisma } from '@prisma/client'
import type { UserCtx } from '../authz'
import { db } from '../db'
import { ForbiddenError, NotFoundError, ValidationError } from '../errors'
import { logAudit } from './audit'

export type CursorInput = { cursor?: string; limit?: number }
export type PageResult<T> = { items: T[]; nextCursor: string | null }

const articleIdSchema = z.string().trim().min(1).max(128)
const categorySchema = z.enum(['FRAUD_CASE', 'GUIDE', 'CONTACT'])
const sortOrderSchema = z.number().int().min(0).max(10_000)

function isWebVideoUrl(value: string): boolean {
  if (value === '') return true
  if (!/^https?:\/\//i.test(value)) return false
  try {
    const url = new URL(value)
    return (url.protocol === 'http:' || url.protocol === 'https:') &&
      url.hostname.length > 0 && url.username === '' && url.password === ''
  } catch {
    return false
  }
}

export const saveArticleSchema = z.object({
  id: articleIdSchema.optional(),
  category: categorySchema,
  title: z.string().trim().min(1).max(200),
  body: z.string().trim().min(1).max(50_000),
  videoUrl: z.string().trim().max(2048).refine(isWebVideoUrl).optional(),
  sortOrder: sortOrderSchema,
  published: z.boolean().default(false),
})

export type ArticleInput = z.input<typeof saveArticleSchema>

const listArticleFields = {
  category: categorySchema.optional(),
  cursor: z.string().min(1).max(512).regex(/^[A-Za-z0-9_-]+$/).optional(),
  limit: z.number().int().min(1).max(50).default(25),
}

export const listArticlesAdminSchema = z.object(listArticleFields)
export const listPublishedArticlesSchema = z.object(listArticleFields)

const articleCursorSchema = z.object({ sortOrder: sortOrderSchema, id: articleIdSchema }).strict()

function decodeArticleCursor(raw: string): z.infer<typeof articleCursorSchema> {
  try {
    const bytes = Buffer.from(raw, 'base64url')
    if (bytes.toString('base64url') !== raw) throw new ValidationError()
    const parsed = articleCursorSchema.safeParse(JSON.parse(bytes.toString('utf8')))
    if (parsed.success) return parsed.data
  } catch {
    // Decode and schema errors share a controlled service error.
  }
  throw new ValidationError()
}

function articleWhere(input: z.output<typeof listArticlesAdminSchema>): Prisma.ArticleWhereInput {
  const cursor = input.cursor ? decodeArticleCursor(input.cursor) : undefined
  return {
    ...(input.category ? { category: input.category } : {}),
    ...(cursor ? {
      OR: [
        { sortOrder: { gt: cursor.sortOrder } },
        { sortOrder: cursor.sortOrder, id: { gt: cursor.id } },
      ],
    } : {}),
  }
}

function articlePage<T extends { id: string; sortOrder: number }>(rows: T[], limit: number): PageResult<T> {
  const items = rows.slice(0, limit)
  const last = items.at(-1)
  return {
    items,
    nextCursor: rows.length > limit && last
      ? Buffer.from(JSON.stringify({ sortOrder: last.sortOrder, id: last.id })).toString('base64url')
      : null,
  }
}

export type ArticleRow = {
  id: string
  category: ArticleCategory
  title: string
  body: string
  videoUrl: string | null
  sortOrder: number
  published: boolean
  updatedAt: Date
}

export type PublicArticle = Pick<
  ArticleRow,
  'id' | 'category' | 'title' | 'body' | 'videoUrl' | 'sortOrder' | 'updatedAt'
>

const publicArticleSelect = {
  id: true, category: true, title: true, body: true,
  videoUrl: true, sortOrder: true, updatedAt: true,
} satisfies Prisma.ArticleSelect

async function assertAdmin(ctx: UserCtx, client: Prisma.TransactionClient | typeof db = db): Promise<void> {
  const actor = await client.user.findUnique({
    where: { id: ctx.userId },
    select: { role: true, status: true },
  })
  if (!actor || actor.role !== 'ADMIN' || actor.status !== 'ACTIVE') throw new ForbiddenError()
}

export async function listArticlesAdmin(
  ctx: UserCtx,
  rawInput: CursorInput & { category?: ArticleCategory },
): Promise<PageResult<ArticleRow>> {
  await assertAdmin(ctx)
  const parsed = listArticlesAdminSchema.safeParse(rawInput)
  if (!parsed.success) throw new ValidationError()
  const input = parsed.data
  const rows = await db.article.findMany({
    where: articleWhere(input),
    orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
    take: input.limit + 1,
    select: { ...publicArticleSelect, published: true },
  })
  return articlePage(rows, input.limit)
}

export async function saveArticle(
  ctx: UserCtx,
  rawInput: ArticleInput,
): Promise<{ id: string }> {
  return db.$transaction(async (tx) => {
    await assertAdmin(ctx, tx)
    const parsed = saveArticleSchema.safeParse(rawInput)
    if (!parsed.success) throw new ValidationError()
    const input = parsed.data
    if (input.id && !await tx.article.findUnique({ where: { id: input.id }, select: { id: true } })) {
      throw new NotFoundError()
    }
    const data = {
      category: input.category,
      title: input.title,
      body: input.body,
      videoUrl: input.videoUrl || null,
      sortOrder: input.sortOrder,
      published: input.published,
    }
    const saved = input.id
      ? await tx.article.update({ where: { id: input.id }, data, select: { id: true } })
      : await tx.article.create({ data, select: { id: true } })
    await logAudit({
      actorId: ctx.userId,
      action: 'article.save',
      targetType: 'Article',
      targetId: saved.id,
      metadata: {
        operation: input.id ? 'update' : 'create',
        category: input.category,
        published: input.published,
        sortOrder: input.sortOrder,
        bodyLength: input.body.length,
      },
    }, tx)
    return saved
  })
}

export async function listPublishedArticles(
  rawInput: CursorInput & { category?: ArticleCategory },
): Promise<PageResult<PublicArticle>> {
  const parsed = listPublishedArticlesSchema.safeParse(rawInput)
  if (!parsed.success) throw new ValidationError()
  const input = parsed.data
  const rows = await db.article.findMany({
    where: { ...articleWhere(input), published: true },
    orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
    take: input.limit + 1,
    select: publicArticleSelect,
  })
  return articlePage(rows, input.limit)
}
