import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/server/auth', () => ({ getSession: vi.fn(), auth: {} }))
vi.mock('@/server/db', async () => {
  const { testDb } = await import('../setup/db')
  return { db: testDb }
})
vi.mock('next/headers', () => ({ headers: vi.fn().mockResolvedValue(new Headers()) }))

import { setupTestDb, testDb } from '../setup/db'
import { createAdmin, createEmployer } from '../factories'
import { ForbiddenError, NotFoundError, ValidationError } from '@/server/errors'
import { listSynonyms, saveSynonymGroup } from '@/server/services/search-synonyms'
import { _clearSynonymCache, invalidateSynonymCache, searchJobs } from '@/server/services/job-search'
import { clearSettingsCache } from '@/server/services/settings'

setupTestDb()
beforeEach(() => { _clearSynonymCache(); clearSettingsCache() })
afterEach(() => { invalidateSynonymCache(); clearSettingsCache() })

type SynonymInput = Parameters<typeof saveSynonymGroup>[1]

function synonymInput(overrides: Partial<SynonymInput> = {}): SynonymInput {
  return { terms: ['cobaltdesk', '琥珀岗位'], active: true, ...overrides }
}

async function searchableJob(companyId: string, createdById: string, title: string, description = 'Synthetic public description') {
  return testDb.job.create({
    data: {
      companyId, createdById, title, description, skills: [], category: null,
      type: 'INTERNSHIP', workMode: 'HYBRID', status: 'PUBLISHED', publishedAt: new Date(),
    },
  })
}

async function searchIds(q: string, mode: 'EXACT' | 'RELATED' = 'RELATED', canSeeDescription = false) {
  const result = await searchJobs({ q, mode, canSeeDescription })
  return [...result.exact, ...result.related].map((hit) => hit.job.id)
}

describe('synonym service authorization and writes', () => {
  it.each([
    { role: 'STUDENT', status: 'ACTIVE' },
    { role: 'EMPLOYER', status: 'ACTIVE' },
    { role: 'ADMIN', status: 'SUSPENDED' },
    { role: 'ADMIN', status: 'DELETED' },
  ] as const)('rejects $status $role on direct reads and writes', async ({ role, status }) => {
    const actor = await testDb.user.create({
      data: { email: 'synonym-unauthorized@example.test', name: 'Synthetic actor', role, status },
    })
    await expect(listSynonyms({ userId: actor.id }, {})).rejects.toBeInstanceOf(ForbiddenError)
    await expect(saveSynonymGroup({ userId: actor.id }, synonymInput())).rejects.toBeInstanceOf(ForbiddenError)
    expect(await testDb.searchSynonymGroup.count()).toBe(0)
    expect(await testDb.auditLog.count({ where: { action: 'search.synonym.save' } })).toBe(0)
  })

  it('rejects missing users and observes admin revocation on the next call', async () => {
    await expect(listSynonyms({ userId: 'missing-synonym-admin' }, {})).rejects.toBeInstanceOf(ForbiddenError)
    await expect(saveSynonymGroup({ userId: 'missing-synonym-admin' }, synonymInput())).rejects.toBeInstanceOf(ForbiddenError)
    const ctx = await createAdmin(testDb)
    await expect(listSynonyms(ctx, {})).resolves.toEqual({ items: [], nextCursor: null })
    await testDb.user.update({ where: { id: ctx.userId }, data: { role: 'STUDENT' } })
    await expect(listSynonyms(ctx, {})).rejects.toBeInstanceOf(ForbiddenError)
    await expect(saveSynonymGroup(ctx, synonymInput())).rejects.toBeInstanceOf(ForbiddenError)
  })

  it('trims, lowercases English and deduplicates before checking unique-term limits', async () => {
    const ctx = await createAdmin(testDb)
    const terms = [...Array<string>(51).fill('  CobaltDesk '), ' 琥珀岗位 ', 'cobaltdesk']
    const saved = await saveSynonymGroup(ctx, synonymInput({ terms }))
    const row = await testDb.searchSynonymGroup.findUniqueOrThrow({ where: { id: saved.id } })
    expect(row.terms).toHaveLength(2)
    expect(new Set(row.terms)).toEqual(new Set(['cobaltdesk', '琥珀岗位']))
    expect(row.active).toBe(true)
  })

  it.each([
    ['empty group', { terms: [] }],
    ['only one term', { terms: ['one'] }],
    ['one normalized unique term', { terms: [' One ', 'ONE'] }],
    ['blank member', { terms: ['one', 'two', '  '] }],
    ['oversized term', { terms: ['one', 'x'.repeat(101)] }],
    ['too many unique terms', { terms: Array.from({ length: 51 }, (_, index) => 'term' + index) }],
    ['nonstring member', { terms: ['one', 3] }],
    ['nonboolean status', { active: 'false' }],
    ['blank update ID', { id: '  ' }],
  ] as const)('rejects %s without a row or audit', async (_label, invalid) => {
    const ctx = await createAdmin(testDb)
    await expect(saveSynonymGroup(ctx, { ...synonymInput(), ...invalid } as SynonymInput))
      .rejects.toBeInstanceOf(ValidationError)
    expect(await testDb.searchSynonymGroup.count()).toBe(0)
    expect(await testDb.auditLog.count({ where: { action: 'search.synonym.save' } })).toBe(0)
  })

  it('accepts 50 unique terms including a 100-character term', async () => {
    const ctx = await createAdmin(testDb)
    const terms = ['x'.repeat(100), ...Array.from({ length: 49 }, (_, index) => 'term' + index)]
    const saved = await saveSynonymGroup(ctx, synonymInput({ terms }))
    expect((await testDb.searchSynonymGroup.findUniqueOrThrow({ where: { id: saved.id } })).terms).toHaveLength(50)
  })

  it('updates seeded IDs and disables a group without deleting it', async () => {
    const ctx = await createAdmin(testDb)
    await testDb.searchSynonymGroup.create({ data: { id: 'seeded-synonyms', terms: ['one', 'two'], active: true } })
    const saved = await saveSynonymGroup(ctx, synonymInput({ id: '  seeded-synonyms  ', active: false }))
    expect(saved).toEqual({ id: 'seeded-synonyms' })
    expect(await testDb.searchSynonymGroup.count()).toBe(1)
    expect((await listSynonyms(ctx, {})).items).toEqual([
      expect.objectContaining({ id: saved.id, active: false, terms: ['cobaltdesk', '琥珀岗位'] }),
    ])
  })

  it('does not upsert unknown update IDs', async () => {
    const ctx = await createAdmin(testDb)
    await expect(saveSynonymGroup(ctx, synonymInput({ id: 'unknown-synonyms' }))).rejects.toBeInstanceOf(NotFoundError)
    expect(await testDb.searchSynonymGroup.count()).toBe(0)
    expect(await testDb.auditLog.count({ where: { action: 'search.synonym.save' } })).toBe(0)
  })

  it('audits create/update with actor, operation, status and count only', async () => {
    const ctx = await createAdmin(testDb)
    const saved = await saveSynonymGroup(ctx, synonymInput())
    expect(await testDb.auditLog.findMany({ where: { action: 'search.synonym.save', targetId: saved.id } }))
      .toEqual([expect.objectContaining({
        actorId: ctx.userId, targetType: 'SearchSynonymGroup', targetId: saved.id,
        metadata: { operation: 'create', active: true, termCount: 2 },
      })])
    await saveSynonymGroup(ctx, synonymInput({ id: saved.id, active: false }))
    const audits = await testDb.auditLog.findMany({ where: { action: 'search.synonym.save', targetId: saved.id } })
    expect(audits).toHaveLength(2)
    expect(audits).toEqual(expect.arrayContaining([expect.objectContaining({
      actorId: ctx.userId, targetType: 'SearchSynonymGroup',
      metadata: { operation: 'update', active: false, termCount: 2 },
    })]))
    const metadata = JSON.stringify(audits.map((row) => row.metadata))
    expect(metadata).not.toContain('cobaltdesk')
    expect(metadata).not.toContain('琥珀岗位')
  })
})

describe('synonym list pagination', () => {
  it('uses updatedAt DESC and id ASC to traverse unchanged data without gaps', async () => {
    const ctx = await createAdmin(testDb)
    const tieTime = new Date('2026-11-01T00:00:00.000Z')
    await testDb.searchSynonymGroup.createMany({
      data: [
        { id: 'tie-c', updatedAt: tieTime }, { id: 'tie-a', updatedAt: tieTime },
        { id: 'tie-b', updatedAt: tieTime },
        { id: 'oldest', updatedAt: new Date('2026-10-01T00:00:00.000Z') },
        { id: 'newest', updatedAt: new Date('2026-11-02T00:00:00.000Z') },
      ].map((row) => ({ ...row, terms: ['synthetic', row.id], active: false })),
    })
    const first = await listSynonyms(ctx, { limit: 2 })
    expect(first.items.map((row) => row.id)).toEqual(['newest', 'tie-a'])
    expect(first.nextCursor).toEqual(expect.any(String))
    const second = await listSynonyms(ctx, { limit: 2, cursor: first.nextCursor! })
    expect(second.items.map((row) => row.id)).toEqual(['tie-b', 'tie-c'])
    expect(second.nextCursor).toEqual(expect.any(String))
    const third = await listSynonyms(ctx, { limit: 2, cursor: second.nextCursor! })
    expect(third.items.map((row) => row.id)).toEqual(['oldest'])
    expect(third.nextCursor).toBeNull()
  })

  it('defaults to 25 rows, permits 50, and rejects invalid limits and cursors', async () => {
    const ctx = await createAdmin(testDb)
    await testDb.searchSynonymGroup.createMany({
      data: Array.from({ length: 51 }, (_, index) => ({
        id: 'bounded-group-' + String(index).padStart(2, '0'), terms: ['term', 'synonym' + index],
      })),
    })
    const first = await listSynonyms(ctx, {})
    expect(first.items).toHaveLength(25)
    expect(first.nextCursor).toEqual(expect.any(String))
    expect((await listSynonyms(ctx, { limit: 50 })).items).toHaveLength(50)
    for (const invalid of [
      { limit: 0 }, { limit: 51 }, { limit: 1.5 },
      { cursor: 'not-a-valid-cursor' }, { cursor: Buffer.from('{}').toString('base64url') },
    ]) {
      await expect(listSynonyms(ctx, invalid)).rejects.toBeInstanceOf(ValidationError)
    }
  })
})

describe('managed synonyms in real job search', () => {
  it('refreshes a warm cache after create, edit, disable and reenable with bidirectional expansion', async () => {
    const ctx = await createAdmin(testDb)
    const employer = await createEmployer(testDb, { legalName: 'Synthetic Search Employer' })
    const english = await searchableJob(employer.companyId, employer.userId, 'cobaltdesk')
    const chinese = await searchableJob(employer.companyId, employer.userId, '琥珀岗位')
    const replacement = await searchableJob(employer.companyId, employer.userId, 'violetdesk')

    // Warm the real process cache before every save; never clear it between operations.
    expect(await searchIds('cobaltdesk')).toEqual([english.id])
    expect(await searchIds('琥珀岗位')).toEqual([chinese.id])
    const saved = await saveSynonymGroup(ctx, synonymInput())
    expect(await searchIds('CobaltDesk')).toEqual(expect.arrayContaining([english.id, chinese.id]))
    expect(await searchIds('琥珀岗位')).toEqual(expect.arrayContaining([english.id, chinese.id]))

    await saveSynonymGroup(ctx, synonymInput({ id: saved.id, terms: ['cobaltdesk', 'violetdesk'] }))
    const edited = await searchIds('cobaltdesk')
    expect(edited).toEqual(expect.arrayContaining([english.id, replacement.id]))
    expect(edited).not.toContain(chinese.id)
    expect(await searchIds('violetdesk')).toEqual(expect.arrayContaining([english.id, replacement.id]))
    expect(await searchIds('琥珀岗位')).toEqual([chinese.id])

    await saveSynonymGroup(ctx, synonymInput({ id: saved.id, terms: ['cobaltdesk', 'violetdesk'], active: false }))
    expect(await searchIds('cobaltdesk')).toEqual([english.id])
    expect(await searchIds('violetdesk')).toEqual([replacement.id])
    await saveSynonymGroup(ctx, synonymInput({ id: saved.id, terms: ['cobaltdesk', 'violetdesk'] }))
    expect(await searchIds('cobaltdesk')).toEqual(expect.arrayContaining([english.id, replacement.id]))
  })

  it('keeps EXACT free of synonym-only title and industry hits when related fallback is disabled', async () => {
    const ctx = await createAdmin(testDb)
    // Isolate EXACT from the separate PRD fallback section for scarce exact matches.
    await testDb.systemSetting.create({ data: { key: 'search.relatedFallbackBelow', value: 0 } })
    const employer = await createEmployer(testDb, { legalName: 'Synthetic Search Employer' })
    const exact = await searchableJob(employer.companyId, employer.userId, 'cobaltdesk')
    const related = await searchableJob(employer.companyId, employer.userId, '琥珀岗位')
    const bankEmployer = await createEmployer(testDb, { legalName: 'Synthetic Bank Employer' })
    await testDb.company.update({ where: { id: bankEmployer.companyId }, data: { industryCode: 'finance.bank' } })
    const industry = await searchableJob(bankEmployer.companyId, bankEmployer.userId, 'Unrelated public role')
    await saveSynonymGroup(ctx, synonymInput({ terms: ['cobaltdesk', '琥珀岗位', 'banking'] }))
    expect(await searchIds('cobaltdesk', 'RELATED')).toEqual(expect.arrayContaining([exact.id, related.id, industry.id]))
    expect(await searchIds('cobaltdesk', 'EXACT')).toEqual([exact.id])
    expect(await searchIds('琥珀岗位', 'EXACT')).toEqual([related.id])
  })

  it('does not expose description-only synonym matches without description access', async () => {
    const ctx = await createAdmin(testDb)
    const employer = await createEmployer(testDb, { legalName: 'Synthetic Search Employer' })
    const hidden = await searchableJob(employer.companyId, employer.userId, 'Ordinary public role', '琥珀岗位')
    await saveSynonymGroup(ctx, synonymInput())
    expect(await searchIds('cobaltdesk', 'RELATED', false)).not.toContain(hidden.id)
    expect(await searchIds('cobaltdesk', 'RELATED', true)).toContain(hidden.id)
    const visible = await searchJobs({ q: 'cobaltdesk', mode: 'RELATED', canSeeDescription: true })
    const hit = [...visible.exact, ...visible.related].find((item) => item.job.id === hidden.id)
    expect(hit?.job).not.toHaveProperty('description')
    expect(hit?.job).not.toHaveProperty('requirements')
  })

  it('observes a change made by another process within 60 seconds', async () => {
    const employer = await createEmployer(testDb, { legalName: 'Synthetic Search Employer' })
    const target = await searchableJob(employer.companyId, employer.userId, '琥珀岗位')
    const group = await testDb.searchSynonymGroup.create({ data: synonymInput() })
    const now = Date.now()
    const clock = vi.spyOn(Date, 'now').mockReturnValue(now)
    try {
      expect(await searchIds('cobaltdesk')).toContain(target.id)
      // A direct DB write models another instance; this process receives no invalidation call.
      await testDb.searchSynonymGroup.update({ where: { id: group.id }, data: { active: false } })
      clock.mockReturnValue(now + 60_001)
      expect(await searchIds('cobaltdesk')).not.toContain(target.id)
    } finally {
      clock.mockRestore()
    }
  })
})
