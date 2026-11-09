import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/server/auth', () => ({ getSession: vi.fn(), auth: {} }))
vi.mock('@/server/db', async () => {
  const { testDb } = await import('../setup/db')
  return { db: testDb }
})
vi.mock('next/headers', () => ({ headers: vi.fn().mockResolvedValue(new Headers()) }))
vi.mock('@/server/services/audit', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/server/services/audit')>()
  return {
    ...actual,
    logAudit: vi.fn(async (...args: Parameters<typeof actual.logAudit>) => {
      // Write a real audit row first: both that row and the content change must roll back.
      await actual.logAudit(...args)
      throw new Error('synthetic content audit failure')
    }),
  }
})

import { setupTestDb, testDb } from '../setup/db'
import { createAdmin, createEmployer } from '../factories'
import { listPublishedArticles, saveArticle } from '@/server/services/articles'
import { saveSynonymGroup } from '@/server/services/search-synonyms'
import { _clearSynonymCache, searchJobs } from '@/server/services/job-search'
import { clearSettingsCache } from '@/server/services/settings'

setupTestDb()
beforeEach(() => { _clearSynonymCache(); clearSettingsCache() })
afterEach(() => { _clearSynonymCache(); clearSettingsCache() })

describe('content writes are atomic with audit writes', () => {
  it('rolls back article creation and the attempted audit row', async () => {
    const ctx = await createAdmin(testDb)
    await expect(saveArticle(ctx, {
      category: 'GUIDE', title: 'Synthetic guide', body: '合成正文 / Synthetic body',
      sortOrder: 0, published: true,
    })).rejects.toThrow('synthetic content audit failure')
    expect(await testDb.article.count()).toBe(0)
    expect(await testDb.auditLog.count({ where: { action: 'article.save' } })).toBe(0)
    expect((await listPublishedArticles({})).items).toEqual([])
  })

  it('rolls back an article withdrawal/edit without replacing the existing public text', async () => {
    const ctx = await createAdmin(testDb)
    const before = await testDb.article.create({
      data: {
        id: 'atomic-published-guide', category: 'GUIDE', title: 'Original safe title',
        body: 'Original safe body / 原正文', videoUrl: 'https://video.example.test/original',
        sortOrder: 5, published: true,
      },
    })
    expect((await listPublishedArticles({})).items.map((row) => row.id)).toEqual([before.id])
    await expect(saveArticle(ctx, {
      id: before.id, category: 'CONTACT', title: 'Changed title', body: 'Changed body',
      videoUrl: '', sortOrder: 0, published: false,
    })).rejects.toThrow('synthetic content audit failure')
    expect(await testDb.article.findUniqueOrThrow({ where: { id: before.id } })).toEqual(before)
    expect(await testDb.auditLog.count({ where: { action: 'article.save' } })).toBe(0)
    expect((await listPublishedArticles({})).items).toEqual([
      expect.objectContaining({ id: before.id, body: before.body, title: before.title, videoUrl: before.videoUrl }),
    ])
  })

  it('rolls back synonym creation and keeps the previously warm search unchanged', async () => {
    const ctx = await createAdmin(testDb)
    const employer = await createEmployer(testDb, { legalName: 'Synthetic Atomic Search Employer' })
    await testDb.job.create({
      data: {
        companyId: employer.companyId, createdById: employer.userId, title: '琥珀岗位',
        description: 'Synthetic description', status: 'PUBLISHED', type: 'INTERNSHIP',
        workMode: 'HYBRID', publishedAt: new Date(),
      },
    })
    const before = await searchJobs({ q: 'cobaltdesk', mode: 'RELATED' })
    expect([...before.exact, ...before.related]).toEqual([])
    await expect(saveSynonymGroup(ctx, { terms: ['cobaltdesk', '琥珀岗位'], active: true }))
      .rejects.toThrow('synthetic content audit failure')
    expect(await testDb.searchSynonymGroup.count()).toBe(0)
    expect(await testDb.auditLog.count({ where: { action: 'search.synonym.save' } })).toBe(0)
    const after = await searchJobs({ q: 'cobaltdesk', mode: 'RELATED' })
    expect([...after.exact, ...after.related]).toEqual([])
  })

  it.each(['edit', 'disable'] as const)('rolls back synonym %s and preserves existing expansion', async (operation) => {
    const ctx = await createAdmin(testDb)
    const employer = await createEmployer(testDb, { legalName: 'Synthetic Atomic Search Employer' })
    const original = await testDb.job.create({
      data: {
        companyId: employer.companyId, createdById: employer.userId, title: '琥珀岗位',
        description: 'Synthetic description', status: 'PUBLISHED', type: 'INTERNSHIP',
        workMode: 'HYBRID', publishedAt: new Date(),
      },
    })
    const replacement = await testDb.job.create({
      data: {
        companyId: employer.companyId, createdById: employer.userId, title: 'violetdesk',
        description: 'Synthetic description', status: 'PUBLISHED', type: 'INTERNSHIP',
        workMode: 'HYBRID', publishedAt: new Date(),
      },
    })
    const before = await testDb.searchSynonymGroup.create({
      data: { terms: ['cobaltdesk', '琥珀岗位'], active: true },
    })
    const warm = await searchJobs({ q: 'cobaltdesk', mode: 'RELATED' })
    expect([...warm.exact, ...warm.related].map((hit) => hit.job.id)).toEqual([original.id])

    await expect(saveSynonymGroup(ctx, {
      id: before.id,
      terms: operation === 'edit' ? ['cobaltdesk', 'violetdesk'] : before.terms,
      active: operation !== 'disable',
    })).rejects.toThrow('synthetic content audit failure')

    expect(await testDb.searchSynonymGroup.findUniqueOrThrow({ where: { id: before.id } })).toEqual(before)
    expect(await testDb.auditLog.count({ where: { action: 'search.synonym.save' } })).toBe(0)
    const after = await searchJobs({ q: 'cobaltdesk', mode: 'RELATED' })
    const ids = [...after.exact, ...after.related].map((hit) => hit.job.id)
    expect(ids).toEqual([original.id])
    expect(ids).not.toContain(replacement.id)
  })
})
