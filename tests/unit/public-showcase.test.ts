import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ setting: vi.fn(), jobs: vi.fn(), companies: vi.fn() }))
vi.mock('@/server/db', () => ({ db: { job: { findMany: mocks.jobs }, company: { findMany: mocks.companies } } }))
vi.mock('@/server/services/settings', () => ({ getSetting: mocks.setting }))

import { DEFAULT_PUBLIC_SHOWCASE, publicShowcaseSchema } from '@/schemas/public-showcase'
import { getPublicJobShowcase, getPublicCompanyShowcase } from '@/server/services/public-showcase'

describe('public showcase configuration', () => {
  it('accepts empty selections and concise bilingual copy', () => {
    expect(publicShowcaseSchema.parse(DEFAULT_PUBLIC_SHOWCASE).jobIds).toEqual([])
  })
  it('rejects duplicates, more than twelve selections, unknown fields and long copy', () => {
    expect(publicShowcaseSchema.safeParse({ ...DEFAULT_PUBLIC_SHOWCASE, jobIds: ['a', 'a'] }).success).toBe(false)
    expect(publicShowcaseSchema.safeParse({ ...DEFAULT_PUBLIC_SHOWCASE, companyIds: Array.from({ length: 13 }, (_, i) => String(i)) }).success).toBe(false)
    expect(publicShowcaseSchema.safeParse({ ...DEFAULT_PUBLIC_SHOWCASE, extra: true }).success).toBe(false)
    expect(publicShowcaseSchema.safeParse({ ...DEFAULT_PUBLIC_SHOWCASE, jobs: { zh: { title: 'x'.repeat(81), description: '' }, en: { title: '', description: '' } } }).success).toBe(false)
  })
})

describe('public showcase previews', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.setting.mockResolvedValue(DEFAULT_PUBLIC_SHOWCASE)
    mocks.jobs.mockResolvedValue([])
    mocks.companies.mockResolvedValue([])
  })
  it('uses a bounded fallback for empty or malformed configuration', async () => {
    await getPublicJobShowcase()
    expect(mocks.jobs.mock.calls[0][0].take).toBe(6)
    mocks.setting.mockResolvedValue({ jobIds: 'bad' })
    await getPublicCompanyShowcase()
    expect(mocks.companies.mock.calls[0][0].take).toBe(6)
  })
  it('preserves explicit ordering and never backfills missing selections', async () => {
    mocks.setting.mockResolvedValue({ ...DEFAULT_PUBLIC_SHOWCASE, jobIds: ['b', 'hidden', 'a'] })
    mocks.jobs.mockResolvedValue([{ id: 'a' }, { id: 'b' }])
    const result = await getPublicJobShowcase()
    expect(result.items.map(item => item.id)).toEqual(['b', 'a'])
    expect(mocks.jobs).toHaveBeenCalledTimes(1)
    expect(mocks.jobs.mock.calls[0][0].where.id).toEqual({ in: ['b', 'hidden', 'a'] })
  })
  it('requires published jobs, future or absent deadlines and active verified companies', async () => {
    await getPublicJobShowcase()
    const query = mocks.jobs.mock.calls[0][0]
    expect(query.where.status).toBe('PUBLISHED')
    expect(query.where.company).toEqual({ isActive: true, verificationStatus: 'VERIFIED' })
    expect(query.where.OR[0]).toEqual({ deadline: null })
    expect(query.where.OR[1].deadline.gt).toBeInstanceOf(Date)
    expect(query.select).not.toHaveProperty('description')
    expect(query.select).not.toHaveProperty('requirements')
    expect(query.select.company.select).not.toHaveProperty('contactEmail')
  })
  it('preserves company order, filters inactive and unverified companies and supports zero records', async () => {
    mocks.setting.mockResolvedValue({ ...DEFAULT_PUBLIC_SHOWCASE, companyIds: ['b', 'a'] })
    mocks.companies.mockResolvedValue([{ id: 'a' }, { id: 'b' }])
    expect((await getPublicCompanyShowcase()).items.map(item => item.id)).toEqual(['b', 'a'])
    expect(mocks.companies.mock.calls[0][0].where).toEqual({ id: { in: ['b', 'a'] }, isActive: true, verificationStatus: 'VERIFIED' })
    mocks.companies.mockResolvedValue([])
    expect((await getPublicCompanyShowcase()).items).toEqual([])
  })
})
