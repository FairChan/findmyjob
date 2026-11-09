import { describe, expect, it, vi } from 'vitest'

vi.mock('@/server/auth', () => ({ getSession: vi.fn(), auth: {} }))
vi.mock('@/server/db', async () => {
  const { testDb } = await import('../setup/db')
  return { db: testDb }
})

import { setupTestDb, testDb } from '../setup/db'
import { createAdmin } from '../factories'
import { ForbiddenError, NotFoundError, ValidationError } from '@/server/errors'
import {
  listArticlesAdmin, listPublishedArticles, saveArticle,
} from '@/server/services/articles'

setupTestDb()

type ArticleInput = Parameters<typeof saveArticle>[1]

function articleInput(overrides: Partial<ArticleInput> = {}): ArticleInput {
  return {
    category: 'GUIDE', title: '求职安全 / Safe job search',
    body: '请核实企业 / Verify the employer.', videoUrl: '',
    sortOrder: 3, published: false, ...overrides,
  }
}

function seedArticle(
  id: string,
  sortOrder: number,
  published = true,
  category: 'GUIDE' | 'FRAUD_CASE' | 'CONTACT' = 'GUIDE',
) {
  return testDb.article.create({
    data: { id, sortOrder, published, category, title: id, body: 'Synthetic bilingual guide / 合成指南' },
  })
}

describe('article service authorization', () => {
  it.each([
    { role: 'STUDENT', status: 'ACTIVE' },
    { role: 'EMPLOYER', status: 'ACTIVE' },
    { role: 'ADMIN', status: 'SUSPENDED' },
    { role: 'ADMIN', status: 'DELETED' },
  ] as const)('rejects $status $role on direct reads and writes', async ({ role, status }) => {
    const actor = await testDb.user.create({
      data: { email: 'content-unauthorized@example.test', name: 'Synthetic actor', role, status },
    })
    await expect(listArticlesAdmin({ userId: actor.id }, {})).rejects.toBeInstanceOf(ForbiddenError)
    await expect(saveArticle({ userId: actor.id }, articleInput())).rejects.toBeInstanceOf(ForbiddenError)
    expect(await testDb.article.count()).toBe(0)
    expect(await testDb.auditLog.count({ where: { action: 'article.save' } })).toBe(0)
  })

  it('rejects a missing actor and observes an admin suspension on the next call', async () => {
    await expect(listArticlesAdmin({ userId: 'missing-content-admin' }, {})).rejects.toBeInstanceOf(ForbiddenError)
    await expect(saveArticle({ userId: 'missing-content-admin' }, articleInput())).rejects.toBeInstanceOf(ForbiddenError)
    const ctx = await createAdmin(testDb)
    await expect(listArticlesAdmin(ctx, {})).resolves.toEqual({ items: [], nextCursor: null })
    await testDb.user.update({ where: { id: ctx.userId }, data: { status: 'SUSPENDED' } })
    await expect(listArticlesAdmin(ctx, {})).rejects.toBeInstanceOf(ForbiddenError)
    await expect(saveArticle(ctx, articleInput())).rejects.toBeInstanceOf(ForbiddenError)
  })
})

describe('article writes', () => {
  it('normalizes text and blank video URLs and creates drafts by default', async () => {
    const ctx = await createAdmin(testDb)
    const draft = {
      category: 'GUIDE' as const, title: '  求职指南 / Guide  ',
      body: '  安全正文 / Safe body  ', videoUrl: '  ', sortOrder: 3,
    }
    const saved = await saveArticle(ctx, draft)
    expect(await testDb.article.findUniqueOrThrow({ where: { id: saved.id } })).toMatchObject({
      title: '求职指南 / Guide', body: '安全正文 / Safe body', videoUrl: null, published: false,
    })
    expect((await listArticlesAdmin(ctx, {})).items.map((row) => row.id)).toEqual([saved.id])
    expect(await listPublishedArticles({})).toEqual({ items: [], nextCursor: null })
  })

  it.each(['http://video.example.test/clip', 'https://video.example.test/watch?v=synthetic'])(
    'accepts an absolute web video link: %s',
    async (videoUrl) => {
      const ctx = await createAdmin(testDb)
      const saved = await saveArticle(ctx, articleInput({ videoUrl: '  ' + videoUrl + '  ' }))
      expect(await testDb.article.findUniqueOrThrow({ where: { id: saved.id } })).toMatchObject({ videoUrl })
    },
  )

  it.each([
    ['empty title', { title: ' \n ' }],
    ['long title', { title: 't'.repeat(201) }],
    ['empty body', { body: ' \n ' }],
    ['long body', { body: 'b'.repeat(50_001) }],
    ['script URL', { videoUrl: 'javascript:alert(1)' }],
    ['data URL', { videoUrl: 'data:text/html,synthetic' }],
    ['relative URL', { videoUrl: '/watch/synthetic' }],
    ['protocol-relative URL', { videoUrl: '//video.example.test/clip' }],
    ['file URL', { videoUrl: 'file:///synthetic.txt' }],
    ['URL username', { videoUrl: 'https://user@video.example.test/clip' }],
    ['URL password', { videoUrl: 'https://user:pass@video.example.test/clip' }],
    ['long URL', { videoUrl: 'https://video.example.test/' + 'v'.repeat(2048) }],
    ['negative sort', { sortOrder: -1 }],
    ['fractional sort', { sortOrder: 1.5 }],
    ['large sort', { sortOrder: 10_001 }],
    ['unsafe integer sort', { sortOrder: Number.MAX_SAFE_INTEGER + 1 }],
    ['non-finite sort', { sortOrder: Number.NaN }],
    ['unknown category', { category: 'UNKNOWN' }],
    ['nonboolean publication', { published: 'false' }],
    ['blank update ID', { id: ' ' }],
  ] as const)('rejects %s at the service boundary without writing', async (_label, invalid) => {
    const ctx = await createAdmin(testDb)
    await expect(saveArticle(ctx, { ...articleInput(), ...invalid } as ArticleInput))
      .rejects.toBeInstanceOf(ValidationError)
    expect(await testDb.article.count()).toBe(0)
    expect(await testDb.auditLog.count({ where: { action: 'article.save' } })).toBe(0)
  })

  it('accepts the documented text and sort boundaries', async () => {
    const ctx = await createAdmin(testDb)
    const saved = await saveArticle(ctx, articleInput({
      title: 't'.repeat(200), body: 'b'.repeat(50_000), sortOrder: 10_000,
    }))
    const row = await testDb.article.findUniqueOrThrow({ where: { id: saved.id } })
    expect(row.title).toHaveLength(200)
    expect(row.body).toHaveLength(50_000)
    expect(row.sortOrder).toBe(10_000)
  })

  it('updates an existing seed ID, publishes, reorders, and immediately withdraws it', async () => {
    const ctx = await createAdmin(testDb)
    const draft = await seedArticle('article-seeded-guide', 10, false)
    await saveArticle(ctx, articleInput({ id: '  ' + draft.id + '  ', published: true, sortOrder: 0 }))
    expect((await listPublishedArticles({})).items.map((row) => row.id)).toEqual([draft.id])
    await saveArticle(ctx, articleInput({ id: draft.id, published: false, sortOrder: 7 }))
    expect((await listPublishedArticles({})).items).toEqual([])
    expect(await testDb.article.count()).toBe(1)
    expect(await testDb.article.findUniqueOrThrow({ where: { id: draft.id } }))
      .toMatchObject({ published: false, sortOrder: 7 })
  })

  it('does not create an article when an update ID is unknown', async () => {
    const ctx = await createAdmin(testDb)
    await expect(saveArticle(ctx, articleInput({ id: 'unknown-article' }))).rejects.toBeInstanceOf(NotFoundError)
    expect(await testDb.article.count()).toBe(0)
    expect(await testDb.auditLog.count({ where: { action: 'article.save' } })).toBe(0)
  })

  it('audits the real actor and structured metadata without copying free text', async () => {
    const ctx = await createAdmin(testDb)
    const input = articleInput({
      title: 'synthetic-title-sentinel', body: 'synthetic-body-sentinel',
      videoUrl: 'https://video.example.test/private-url-sentinel',
    })
    const saved = await saveArticle(ctx, input)
    expect(await testDb.auditLog.findMany({ where: { action: 'article.save', targetId: saved.id } }))
      .toEqual([expect.objectContaining({
        actorId: ctx.userId, targetType: 'Article', targetId: saved.id,
        metadata: { operation: 'create', category: 'GUIDE', published: false, sortOrder: 3, bodyLength: input.body.length },
      })])
    await saveArticle(ctx, { ...input, id: saved.id, published: true, sortOrder: 4 })
    const audits = await testDb.auditLog.findMany({ where: { action: 'article.save', targetId: saved.id } })
    expect(audits).toHaveLength(2)
    expect(audits).toEqual(expect.arrayContaining([expect.objectContaining({
      actorId: ctx.userId, targetType: 'Article',
      metadata: { operation: 'update', category: 'GUIDE', published: true, sortOrder: 4, bodyLength: input.body.length },
    })]))
    const metadata = JSON.stringify(audits.map((row) => row.metadata))
    expect(metadata).not.toContain(input.title)
    expect(metadata).not.toContain(input.body)
    expect(metadata).not.toContain(input.videoUrl)
  })
})

describe('article reads and pagination', () => {
  it('enforces published-only access and an explicit public projection', async () => {
    const published = await seedArticle('published-guide', 0)
    await seedArticle('unpublished-guide', 1, false)
    await seedArticle('published-contact', 2, true, 'CONTACT')
    // This spy checks the specified data-minimization boundary; returned data is real.
    const read = vi.spyOn(testDb.article, 'findMany')
    try {
      const result = await listPublishedArticles({
        category: 'GUIDE', published: false,
      } as Parameters<typeof listPublishedArticles>[0])
      expect(result.items).toEqual([{
        id: published.id, category: published.category, title: published.title,
        body: published.body, videoUrl: null, sortOrder: 0, updatedAt: published.updatedAt,
      }])
      expect(result.nextCursor).toBeNull()
      expect(read).toHaveBeenCalledWith(expect.objectContaining({
        select: {
          id: true, category: true, title: true, body: true,
          videoUrl: true, sortOrder: true, updatedAt: true,
        },
      }))
    } finally {
      read.mockRestore()
    }
  })

  it('uses sortOrder then ID for stable public and admin pages with category filtering', async () => {
    const ctx = await createAdmin(testDb)
    await seedArticle('tie-c', 10)
    await seedArticle('tie-a', 10)
    await seedArticle('tie-b', 10)
    await seedArticle('last', 20)
    await seedArticle('first', 0)
    await seedArticle('other-category', 0, true, 'CONTACT')
    for (const read of [
      (cursor?: string) => listPublishedArticles({ category: 'GUIDE', limit: 2, cursor }),
      (cursor?: string) => listArticlesAdmin(ctx, { category: 'GUIDE', limit: 2, cursor }),
    ]) {
      const first = await read()
      expect(first.items.map((row) => row.id)).toEqual(['first', 'tie-a'])
      expect(first.nextCursor).toEqual(expect.any(String))
      const second = await read(first.nextCursor!)
      expect(second.items.map((row) => row.id)).toEqual(['tie-b', 'tie-c'])
      expect(second.nextCursor).toEqual(expect.any(String))
      const third = await read(second.nextCursor!)
      expect(third.items.map((row) => row.id)).toEqual(['last'])
      expect(third.nextCursor).toBeNull()
    }
  })

  it('bounds pages at default 25 and maximum 50 and rejects malformed paging input', async () => {
    const ctx = await createAdmin(testDb)
    await testDb.article.createMany({
      data: Array.from({ length: 51 }, (_, index) => ({
        id: 'bounded-article-' + String(index).padStart(2, '0'),
        category: 'GUIDE' as const, title: 'Synthetic guide', body: '合成 / Synthetic',
        sortOrder: index, published: true,
      })),
    })
    for (const read of [
      (input: Parameters<typeof listPublishedArticles>[0]) => listPublishedArticles(input),
      (input: Parameters<typeof listArticlesAdmin>[1]) => listArticlesAdmin(ctx, input),
    ]) {
      const first = await read({})
      expect(first.items).toHaveLength(25)
      expect(first.nextCursor).toEqual(expect.any(String))
      expect((await read({ limit: 50 })).items).toHaveLength(50)
      for (const invalid of [
        { limit: 0 }, { limit: 51 }, { limit: 1.5 },
        { cursor: 'not-a-valid-cursor' }, { cursor: Buffer.from('{}').toString('base64url') },
      ]) {
        await expect(read(invalid)).rejects.toBeInstanceOf(ValidationError)
      }
    }
  })
})
