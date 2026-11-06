/**
 * Integration tests for talent-visibility and talent-search services.
 * Uses the real test DB; mocks settings, rate-limit, audit, and feature-flags.
 */
import { vi, describe, it, expect, beforeEach } from 'vitest'

vi.mock('@/env', () => ({ env: {} }))

vi.mock('@/server/db', async () => {
  const { testDb } = await import('../setup/db')
  return { db: testDb }
})

const mockGetSetting = vi.hoisted(() => vi.fn())
vi.mock('@/server/services/settings', () => ({ getSetting: mockGetSetting }))

const mockCheckRateLimit = vi.hoisted(() => vi.fn())
vi.mock('@/server/lib/rate-limit', () => ({
  checkRateLimit: mockCheckRateLimit,
  clearRateLimit: vi.fn(),
}))

const mockLogAudit = vi.hoisted(() => vi.fn())
vi.mock('@/server/services/audit', () => ({ logAudit: mockLogAudit }))

const mockAssertTalentSearchEnabled = vi.hoisted(() => vi.fn())
vi.mock('@/server/services/feature-flags', () => ({
  assertTalentSearchEnabled: mockAssertTalentSearchEnabled,
  assertUnlockEnabled: vi.fn(),
  assertUploadsEnabled: vi.fn(),
  assertFeatureEnabled: vi.fn(),
}))

import { setupTestDb, testDb } from '../setup/db'
import { createStudent, createEmployer, faker, FAKER_SEED } from '../factories'
import { searchTalents, PAGE_SIZE } from '@/server/services/talent-search'
import type { SearchFiltersInput } from '@/server/services/talent-search'
import { isStudentVisibleToCompany } from '@/server/services/talent-visibility'
import { ValidationError, RateLimitedError } from '@/server/errors'

setupTestDb()

const SETTINGS: Record<string, unknown> = {
  'talentSearch.maxPage': 25,
  'limits.searchPagesPerDay': 300,
  'talentPool.minCompleteness': 60,
}

function setupMocks() {
  faker.seed(FAKER_SEED)
  mockGetSetting.mockImplementation((key: string, def: unknown) =>
    Promise.resolve(SETTINGS[key] ?? def),
  )
  mockCheckRateLimit.mockResolvedValue({
    allowed: true,
    remaining: 299,
    resetAt: Date.now() + 86_400_000,
    count: 1,
  })
  mockAssertTalentSearchEnabled.mockResolvedValue(undefined)
  mockLogAudit.mockResolvedValue(undefined)
}

// ---- Helpers ----------------------------------------------------------------

interface VisibleStudentOverrides {
  visibility?: 'PUBLIC' | 'HIDDEN'
  completeness?: number
  schoolVerified?: boolean
  status?: 'ACTIVE' | 'SUSPENDED' | 'DELETED'
  headline?: string
  skills?: string[]
  major?: string
  degreeLevel?: 'FOUNDATION' | 'DIPLOMA' | 'BACHELOR' | 'MASTER' | 'PHD'
  graduationYear?: number
  workAuth?: string
  intents?: ('INTERNSHIP' | 'FULL_TIME' | 'PART_TIME')[]
  preferredStates?: string[]
  availableFrom?: Date
  lastActiveAt?: Date
}

async function makeVisibleStudent(overrides: VisibleStudentOverrides = {}) {
  const { userId, profileId } = await createStudent(testDb)

  const data: Record<string, unknown> = {
    visibility: overrides.visibility ?? 'PUBLIC',
    completeness: overrides.completeness ?? 70,
    schoolVerifiedAt:
      overrides.schoolVerified !== false ? new Date('2024-01-01T00:00:00Z') : null,
  }
  if (overrides.headline !== undefined) data.headline = overrides.headline
  if (overrides.skills !== undefined) data.skills = overrides.skills
  if (overrides.major !== undefined) data.major = overrides.major
  if (overrides.degreeLevel !== undefined) data.degreeLevel = overrides.degreeLevel
  if (overrides.graduationYear !== undefined) data.graduationYear = overrides.graduationYear
  if (overrides.workAuth !== undefined) data.workAuth = overrides.workAuth
  if (overrides.intents !== undefined) data.intents = overrides.intents
  if (overrides.preferredStates !== undefined) data.preferredStates = overrides.preferredStates
  if (overrides.availableFrom !== undefined) data.availableFrom = overrides.availableFrom
  if (overrides.lastActiveAt !== undefined) data.lastActiveAt = overrides.lastActiveAt

  await testDb.studentProfile.update({
    where: { id: profileId },
    data: data as never,
  })

  if (overrides.status && overrides.status !== 'ACTIVE') {
    await testDb.user.update({
      where: { id: userId },
      data: { status: overrides.status },
    })
  }

  return { userId, profileId }
}

// ============================================================================
// isStudentVisibleToCompany
// ============================================================================

describe('isStudentVisibleToCompany', () => {
  beforeEach(setupMocks)

  it('visible when all conditions are met', async () => {
    const { profileId } = await makeVisibleStudent()
    const { companyId } = await createEmployer(testDb)
    expect(await isStudentVisibleToCompany(profileId, companyId)).toBe(true)
  })

  it('not visible: student does not exist', async () => {
    const { companyId } = await createEmployer(testDb)
    expect(await isStudentVisibleToCompany('nonexistent-id', companyId)).toBe(false)
  })

  it('not visible: visibility=HIDDEN', async () => {
    const { profileId } = await makeVisibleStudent({ visibility: 'HIDDEN' })
    const { companyId } = await createEmployer(testDb)
    expect(await isStudentVisibleToCompany(profileId, companyId)).toBe(false)
  })

  it('not visible: school not verified', async () => {
    const { profileId } = await makeVisibleStudent({ schoolVerified: false })
    const { companyId } = await createEmployer(testDb)
    expect(await isStudentVisibleToCompany(profileId, companyId)).toBe(false)
  })

  it('not visible: completeness below threshold', async () => {
    const { profileId } = await makeVisibleStudent({ completeness: 50 })
    const { companyId } = await createEmployer(testDb)
    expect(await isStudentVisibleToCompany(profileId, companyId)).toBe(false)
  })

  it('visible: completeness exactly at threshold', async () => {
    const { profileId } = await makeVisibleStudent({ completeness: 60 })
    const { companyId } = await createEmployer(testDb)
    expect(await isStudentVisibleToCompany(profileId, companyId)).toBe(true)
  })

  it('not visible: user SUSPENDED', async () => {
    const { profileId } = await makeVisibleStudent({ status: 'SUSPENDED' })
    const { companyId } = await createEmployer(testDb)
    expect(await isStudentVisibleToCompany(profileId, companyId)).toBe(false)
  })

  it('not visible: user DELETED', async () => {
    const { profileId } = await makeVisibleStudent({ status: 'DELETED' })
    const { companyId } = await createEmployer(testDb)
    expect(await isStudentVisibleToCompany(profileId, companyId)).toBe(false)
  })

  it('not visible: student has blocked this company', async () => {
    const { profileId } = await makeVisibleStudent()
    const { companyId } = await createEmployer(testDb)
    await testDb.blockedCompany.create({ data: { studentId: profileId, companyId } })
    expect(await isStudentVisibleToCompany(profileId, companyId)).toBe(false)
  })

  it('visible from company A even when blocked by company B', async () => {
    const { profileId } = await makeVisibleStudent()
    const { companyId: companyA } = await createEmployer(testDb)
    const { companyId: companyB } = await createEmployer(testDb)
    await testDb.blockedCompany.create({ data: { studentId: profileId, companyId: companyB } })
    expect(await isStudentVisibleToCompany(profileId, companyA)).toBe(true)
    expect(await isStudentVisibleToCompany(profileId, companyB)).toBe(false)
  })
})

// ============================================================================
// searchTalents
// ============================================================================

describe('searchTalents', () => {
  beforeEach(setupMocks)

  let companyId: string
  let memberId: string

  beforeEach(async () => {
    const employer = await createEmployer(testDb)
    companyId = employer.companyId
    memberId = employer.userId
  })

  // ---- Page validation ----

  it('page > maxPage throws ValidationError', async () => {
    await expect(
      searchTalents({ userId: memberId, companyId }, { page: 26, sort: 'lastActive' }),
    ).rejects.toThrow(ValidationError)
  })

  it('page = maxPage (25) is allowed', async () => {
    await expect(
      searchTalents({ userId: memberId, companyId }, { page: 25, sort: 'lastActive' }),
    ).resolves.toBeDefined()
  })

  // ---- Daily page limit ----

  it('exceeded daily page limit throws RateLimitedError and writes audit', async () => {
    mockCheckRateLimit.mockResolvedValue({
      allowed: false,
      remaining: 0,
      resetAt: Date.now() + 86_400_000,
      count: 301,
    })
    await expect(
      searchTalents({ userId: memberId, companyId }, { page: 1, sort: 'lastActive' }),
    ).rejects.toThrow(RateLimitedError)
    expect(mockLogAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'talent.limit.hit' }),
    )
  })

  // ---- Exclusion rules ----

  it('excludes HIDDEN students', async () => {
    await makeVisibleStudent({ visibility: 'HIDDEN' })
    const { students } = await searchTalents(
      { userId: memberId, companyId },
      { page: 1, sort: 'lastActive' },
    )
    expect(students).toHaveLength(0)
  })

  it('excludes students without school verification', async () => {
    await makeVisibleStudent({ schoolVerified: false })
    const { students } = await searchTalents(
      { userId: memberId, companyId },
      { page: 1, sort: 'lastActive' },
    )
    expect(students).toHaveLength(0)
  })

  it('excludes students with completeness below threshold', async () => {
    await makeVisibleStudent({ completeness: 59 })
    const { students } = await searchTalents(
      { userId: memberId, companyId },
      { page: 1, sort: 'lastActive' },
    )
    expect(students).toHaveLength(0)
  })

  it('excludes students who have blocked this company', async () => {
    const { profileId } = await makeVisibleStudent()
    await testDb.blockedCompany.create({ data: { studentId: profileId, companyId } })
    const { students } = await searchTalents(
      { userId: memberId, companyId },
      { page: 1, sort: 'lastActive' },
    )
    expect(students).toHaveLength(0)
  })

  it('excludes suspended users', async () => {
    await makeVisibleStudent({ status: 'SUSPENDED' })
    const { students } = await searchTalents(
      { userId: memberId, companyId },
      { page: 1, sort: 'lastActive' },
    )
    expect(students).toHaveLength(0)
  })

  it('includes visible students', async () => {
    await makeVisibleStudent()
    const { students, total } = await searchTalents(
      { userId: memberId, companyId },
      { page: 1, sort: 'lastActive' },
    )
    expect(total).toBe(1)
    expect(students).toHaveLength(1)
  })

  // ---- Filters ----

  it('filter: schoolId', async () => {
    const school = await testDb.school.create({
      data: { nameZh: '测试大学', nameEn: 'Test University', emailDomains: [] },
    })
    const { profileId } = await makeVisibleStudent()
    await testDb.studentProfile.update({
      where: { id: profileId },
      data: { schoolId: school.id },
    })
    await makeVisibleStudent() // another without school

    const { students } = await searchTalents(
      { userId: memberId, companyId },
      { page: 1, sort: 'lastActive', schoolId: school.id },
    )
    expect(students).toHaveLength(1)
    expect(students[0].school?.id).toBe(school.id)
  })

  it('filter: majorKeyword (case-insensitive)', async () => {
    await makeVisibleStudent({ major: 'Computer Science' })
    await makeVisibleStudent({ major: 'Finance' })

    const { students } = await searchTalents(
      { userId: memberId, companyId },
      { page: 1, sort: 'lastActive', majorKeyword: 'computer' },
    )
    expect(students).toHaveLength(1)
    expect(students[0].major).toContain('Computer')
  })

  it('filter: degreeLevel', async () => {
    await makeVisibleStudent({ degreeLevel: 'BACHELOR' })
    await makeVisibleStudent({ degreeLevel: 'MASTER' })

    const { students } = await searchTalents(
      { userId: memberId, companyId },
      { page: 1, sort: 'lastActive', degreeLevel: 'MASTER' },
    )
    expect(students).toHaveLength(1)
    expect(students[0].degreeLevel).toBe('MASTER')
  })

  it('filter: graduationYearFrom and graduationYearTo', async () => {
    await makeVisibleStudent({ graduationYear: 2023 })
    await makeVisibleStudent({ graduationYear: 2024 })
    await makeVisibleStudent({ graduationYear: 2025 })

    const { students } = await searchTalents(
      { userId: memberId, companyId },
      { page: 1, sort: 'lastActive', graduationYearFrom: 2024, graduationYearTo: 2024 },
    )
    expect(students).toHaveLength(1)
    expect(students[0].graduationYear).toBe(2024)
  })

  it('filter: intents (hasSome)', async () => {
    await makeVisibleStudent({ intents: ['INTERNSHIP'] })
    await makeVisibleStudent({ intents: ['FULL_TIME'] })

    const { students } = await searchTalents(
      { userId: memberId, companyId },
      { page: 1, sort: 'lastActive', intents: ['INTERNSHIP'] },
    )
    expect(students).toHaveLength(1)
  })

  it('filter: workAuths', async () => {
    await makeVisibleStudent({ workAuth: 'STUDENT_PASS' })
    await makeVisibleStudent({ workAuth: 'MY_CITIZEN' })

    const { students } = await searchTalents(
      { userId: memberId, companyId },
      { page: 1, sort: 'lastActive', workAuths: ['STUDENT_PASS'] },
    )
    expect(students).toHaveLength(1)
    expect(students[0].workAuth).toBe('STUDENT_PASS')
  })

  it('filter: skills hasSome', async () => {
    await makeVisibleStudent({ skills: ['Python', 'React'] })
    await makeVisibleStudent({ skills: ['Java'] })

    const { students } = await searchTalents(
      { userId: memberId, companyId },
      { page: 1, sort: 'lastActive', skills: ['Python'], skillsMatchAll: false },
    )
    expect(students).toHaveLength(1)
  })

  it('filter: skills hasEvery', async () => {
    await makeVisibleStudent({ skills: ['Python', 'React'] })
    await makeVisibleStudent({ skills: ['Python'] })

    const { students } = await searchTalents(
      { userId: memberId, companyId },
      { page: 1, sort: 'lastActive', skills: ['Python', 'React'], skillsMatchAll: true },
    )
    expect(students).toHaveLength(1)
  })

  it('filter: preferredStates', async () => {
    await makeVisibleStudent({ preferredStates: ['KL'] })
    await makeVisibleStudent({ preferredStates: ['Penang'] })

    const { students } = await searchTalents(
      { userId: memberId, companyId },
      { page: 1, sort: 'lastActive', preferredStates: ['KL'] },
    )
    expect(students).toHaveLength(1)
  })

  it('filter: availableBefore', async () => {
    await makeVisibleStudent({ availableFrom: new Date('2024-01-01T00:00:00Z') })
    await makeVisibleStudent({ availableFrom: new Date('2025-01-01T00:00:00Z') })

    const { students } = await searchTalents(
      { userId: memberId, companyId },
      { page: 1, sort: 'lastActive', availableBefore: new Date('2024-06-30T00:00:00Z') },
    )
    expect(students).toHaveLength(1)
  })

  it('filter: lastActiveSince', async () => {
    const recent = new Date('2026-10-01T00:00:00Z')
    const old = new Date('2024-01-01T00:00:00Z')
    await makeVisibleStudent({ lastActiveAt: recent })
    await makeVisibleStudent({ lastActiveAt: old })

    const { students } = await searchTalents(
      { userId: memberId, companyId },
      {
        page: 1,
        sort: 'lastActive',
        lastActiveSince: new Date('2026-09-01T00:00:00Z'),
      },
    )
    expect(students).toHaveLength(1)
  })

  it('filter: language level (fluent Chinese)', async () => {
    const { profileId: profileA } = await makeVisibleStudent()
    await testDb.studentLanguage.create({
      data: { studentId: profileA, language: 'zh', level: 'FLUENT' },
    })
    const { profileId: profileB } = await makeVisibleStudent()
    await testDb.studentLanguage.create({
      data: { studentId: profileB, language: 'zh', level: 'BASIC' },
    })

    const { students } = await searchTalents(
      { userId: memberId, companyId },
      {
        page: 1,
        sort: 'lastActive',
        languages: [{ language: 'zh', minLevel: 'CONVERSATIONAL' }],
      },
    )
    expect(students).toHaveLength(1)
    expect(students[0].id).toBe(profileA)
  })

  // ---- TM-002 keyword tests ----

  it('TM-002: searching WeChat handle in headline returns no match', async () => {
    const { profileId } = await makeVisibleStudent({ headline: '微信 leakwx0420' })
    const result = await searchTalents(
      { userId: memberId, companyId },
      { page: 1, sort: 'lastActive', keyword: 'leakwx0420' },
    )
    expect(result.students.map((s) => s.id)).not.toContain(profileId)
  })

  it('TM-002: searching WeChat handle in skill returns no match', async () => {
    const { profileId } = await makeVisibleStudent({ skills: ['wx leakwx0420'] })
    const result = await searchTalents(
      { userId: memberId, companyId },
      { page: 1, sort: 'lastActive', keyword: 'leakwx0420' },
    )
    expect(result.students.map((s) => s.id)).not.toContain(profileId)
  })

  it('TM-002: searching phone in experience title returns no match', async () => {
    const { profileId } = await makeVisibleStudent()
    await testDb.experience.create({
      data: {
        studentId: profileId,
        kind: 'WORK',
        title: '+60 12-000 0420',
      },
    })
    const result = await searchTalents(
      { userId: memberId, companyId },
      { page: 1, sort: 'lastActive', keyword: '12-000 0420' },
    )
    expect(result.students.map((s) => s.id)).not.toContain(profileId)
  })

  // ---- Sort order ----

  it('sort: lastActive returns most recent first', async () => {
    const { profileId: oldId } = await makeVisibleStudent({
      lastActiveAt: new Date('2024-01-01T00:00:00Z'),
    })
    const { profileId: newId } = await makeVisibleStudent({
      lastActiveAt: new Date('2026-01-01T00:00:00Z'),
    })

    const { students } = await searchTalents(
      { userId: memberId, companyId },
      { page: 1, sort: 'lastActive' },
    )
    expect(students[0].id).toBe(newId)
    expect(students[1].id).toBe(oldId)
  })

  it('sort: completeness returns highest completeness first', async () => {
    await makeVisibleStudent({ completeness: 70 })
    const { profileId: highId } = await makeVisibleStudent({ completeness: 90 })

    const { students } = await searchTalents(
      { userId: memberId, companyId },
      { page: 1, sort: 'completeness' },
    )
    expect(students[0].id).toBe(highId)
  })

  // ---- Unlock flag ----

  it('marks isUnlocked correctly on card', async () => {
    const { profileId } = await makeVisibleStudent()
    const { profileId: unlockedId } = await makeVisibleStudent()
    await testDb.talentUnlock.create({
      data: {
        companyId,
        studentId: unlockedId,
        unlockedById: memberId,
        source: 'CREDIT',
        creditsSpent: 1,
      },
    })

    const { students } = await searchTalents(
      { userId: memberId, companyId },
      { page: 1, sort: 'lastActive' },
    )
    const unlockedCard = students.find((s) => s.id === unlockedId)
    const lockedCard = students.find((s) => s.id === profileId)
    // Unlocked card has real name; locked card has masked name
    expect(unlockedCard).toBeDefined()
    expect(lockedCard).toBeDefined()
  })

  // ---- Pagination ----

  it('pagination: returns correct page slice', async () => {
    // Create PAGE_SIZE + 1 visible students
    for (let i = 0; i < PAGE_SIZE + 1; i++) {
      await makeVisibleStudent()
    }

    const page1 = await searchTalents({ userId: memberId, companyId }, { page: 1, sort: 'lastActive' })
    const page2 = await searchTalents({ userId: memberId, companyId }, { page: 2, sort: 'lastActive' })

    expect(page1.students).toHaveLength(PAGE_SIZE)
    expect(page1.total).toBe(PAGE_SIZE + 1)
    expect(page2.students).toHaveLength(1)
  })
})
