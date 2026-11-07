import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/env', () => ({ env: {} }))

const mockDb = vi.hoisted(() => ({
  studentProfile: {
    findUnique: vi.fn(),
    update: vi.fn(),
  },
  consent: {
    findFirst: vi.fn(),
    create: vi.fn(),
    createMany: vi.fn(),
  },
  blockedCompany: {
    findMany: vi.fn(),
    upsert: vi.fn(),
    deleteMany: vi.fn(),
  },
  company: {
    findUnique: vi.fn(),
    findMany: vi.fn(),
  },
  profileView: {
    findMany: vi.fn(),
  },
  $queryRaw: vi.fn(),
  talentUnlock: {
    findMany: vi.fn(),
  },
  auditLog: {
    create: vi.fn(),
  },
  $transaction: vi.fn((ops: unknown) => Promise.all(ops as Promise<unknown>[])),
}))
vi.mock('@/server/db', () => ({ db: mockDb }))

const mockGetSetting = vi.hoisted(() => vi.fn())
vi.mock('@/server/services/settings', () => ({ getSetting: mockGetSetting }))

import {
  getLatestTalentPoolConsent,
  setVisibility,
  listBlockedCompanies,
  addBlockedCompany,
  removeBlockedCompany,
  searchVerifiedCompanies,
  getProfileViews,
  getUnlocks,
} from '@/server/services/privacy'
import { NotFoundError } from '@/server/errors'

const USER_ID = 'cltest000000user00000'
const PROFILE_ID = 'cltest000000prof00000'
const COMPANY_ID = 'cltest000000comp00000'
const ctx = { userId: USER_ID }

beforeEach(() => {
  vi.clearAllMocks()
  mockGetSetting.mockResolvedValue('1.0')
  mockDb.studentProfile.findUnique.mockResolvedValue({ id: PROFILE_ID })
  mockDb.studentProfile.update.mockResolvedValue({})
  mockDb.consent.create.mockResolvedValue({})
  mockDb.auditLog.create.mockResolvedValue({})
  mockDb.$transaction.mockImplementation(
    (ops: unknown) => Promise.all(ops as Promise<unknown>[]),
  )
})

describe('getLatestTalentPoolConsent', () => {
  it('returns null when no consent exists', async () => {
    mockDb.consent.findFirst.mockResolvedValue(null)
    expect(await getLatestTalentPoolConsent(USER_ID)).toBeNull()
  })

  it('returns true when latest TALENT_POOL consent is granted', async () => {
    mockDb.consent.findFirst.mockResolvedValue({ granted: true })
    expect(await getLatestTalentPoolConsent(USER_ID)).toBe(true)
  })

  it('returns false when latest TALENT_POOL consent is not granted', async () => {
    mockDb.consent.findFirst.mockResolvedValue({ granted: false })
    expect(await getLatestTalentPoolConsent(USER_ID)).toBe(false)
  })
})

describe('setVisibility', () => {
  it('sets PUBLIC visibility and writes granted consent', async () => {
    await setVisibility(ctx, { granted: true })

    expect(mockDb.$transaction).toHaveBeenCalled()
    expect(mockDb.studentProfile.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ visibility: 'PUBLIC' }),
      }),
    )
    expect(mockDb.consent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ type: 'TALENT_POOL', granted: true }),
      }),
    )
    expect(mockDb.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: 'student.visibility.change' }),
      }),
    )
  })

  it('sets HIDDEN visibility and writes revoked consent', async () => {
    await setVisibility(ctx, { granted: false })

    expect(mockDb.studentProfile.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ visibility: 'HIDDEN' }),
      }),
    )
    expect(mockDb.consent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ type: 'TALENT_POOL', granted: false }),
      }),
    )
  })

  it('throws NotFoundError when profile not found', async () => {
    mockDb.studentProfile.findUnique.mockResolvedValue(null)
    await expect(setVisibility(ctx, { granted: true })).rejects.toBeInstanceOf(NotFoundError)
  })
})

describe('listBlockedCompanies', () => {
  it('returns empty array when profile not found', async () => {
    mockDb.studentProfile.findUnique.mockResolvedValue(null)
    expect(await listBlockedCompanies(ctx)).toEqual([])
  })

  it('returns blocked companies with display name', async () => {
    mockDb.blockedCompany.findMany.mockResolvedValue([
      {
        companyId: COMPANY_ID,
        createdAt: new Date('2026-01-01'),
        company: { legalName: 'Legal Name', displayNameZh: '显示名称', displayNameEn: null },
      },
    ])
    const result = await listBlockedCompanies(ctx)
    expect(result).toHaveLength(1)
    expect(result[0].companyName).toBe('显示名称')
  })

  it('falls back to legalName when no display name', async () => {
    mockDb.blockedCompany.findMany.mockResolvedValue([
      {
        companyId: COMPANY_ID,
        createdAt: new Date('2026-01-01'),
        company: { legalName: 'Legal Name', displayNameZh: null, displayNameEn: null },
      },
    ])
    const result = await listBlockedCompanies(ctx)
    expect(result[0].companyName).toBe('Legal Name')
  })
})

describe('addBlockedCompany', () => {
  it('upserts a blocked company', async () => {
    mockDb.company.findUnique.mockResolvedValue({ id: COMPANY_ID, verificationStatus: 'VERIFIED' })
    mockDb.blockedCompany.upsert.mockResolvedValue({})

    await addBlockedCompany(ctx, { companyId: COMPANY_ID })

    expect(mockDb.blockedCompany.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ studentId: PROFILE_ID, companyId: COMPANY_ID }),
      }),
    )
  })

  it('throws NotFoundError for non-verified company', async () => {
    mockDb.company.findUnique.mockResolvedValue({ id: COMPANY_ID, verificationStatus: 'PENDING' })
    await expect(addBlockedCompany(ctx, { companyId: COMPANY_ID })).rejects.toBeInstanceOf(
      NotFoundError,
    )
  })

  it('throws NotFoundError when company does not exist', async () => {
    mockDb.company.findUnique.mockResolvedValue(null)
    await expect(addBlockedCompany(ctx, { companyId: COMPANY_ID })).rejects.toBeInstanceOf(
      NotFoundError,
    )
  })
})

describe('removeBlockedCompany', () => {
  it('deletes the blocked company entry', async () => {
    mockDb.blockedCompany.deleteMany.mockResolvedValue({ count: 1 })
    await removeBlockedCompany(ctx, { companyId: COMPANY_ID })
    expect(mockDb.blockedCompany.deleteMany).toHaveBeenCalledWith({
      where: { studentId: PROFILE_ID, companyId: COMPANY_ID },
    })
  })
})

describe('searchVerifiedCompanies', () => {
  it('returns matched verified companies', async () => {
    mockDb.company.findMany.mockResolvedValue([
      { id: COMPANY_ID, legalName: 'TechCorp', displayNameZh: '科技公司', displayNameEn: null },
    ])
    const result = await searchVerifiedCompanies({ query: 'Tech' })
    expect(result).toHaveLength(1)
    expect(result[0].name).toBe('科技公司')
  })

  it('queries with VERIFIED status filter', async () => {
    mockDb.company.findMany.mockResolvedValue([])
    await searchVerifiedCompanies({ query: 'abc' })
    expect(mockDb.company.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ verificationStatus: 'VERIFIED' }),
      }),
    )
  })
})

describe('getProfileViews', () => {
  it('returns empty list when profile not found', async () => {
    mockDb.studentProfile.findUnique.mockResolvedValue(null)
    expect(await getProfileViews(ctx)).toEqual([])
  })

  it('maps $queryRaw rows to viewedAt entries', async () => {
    const now = new Date('2026-11-05T01:00:00Z')
    mockDb.$queryRaw.mockResolvedValue([
      {
        companyId: COMPANY_ID,
        createdAt: now,
        legalName: 'Corp',
        displayNameZh: null,
        displayNameEn: null,
      },
    ])
    const result = await getProfileViews(ctx)
    expect(result).toHaveLength(1)
    expect(result[0].viewedAt).toEqual(now)
    expect(result[0].companyName).toBe('Corp')
  })
})

describe('getUnlocks', () => {
  it('returns empty list when profile not found', async () => {
    mockDb.studentProfile.findUnique.mockResolvedValue(null)
    expect(await getUnlocks(ctx)).toEqual([])
  })

  it('returns all unlock records', async () => {
    mockDb.talentUnlock.findMany.mockResolvedValue([
      {
        companyId: COMPANY_ID,
        createdAt: new Date('2026-06-01'),
        company: { legalName: 'TechCorp', displayNameZh: null, displayNameEn: 'TechCorp' },
      },
    ])
    const result = await getUnlocks(ctx)
    expect(result).toHaveLength(1)
    expect(result[0].companyName).toBe('TechCorp')
  })
})
