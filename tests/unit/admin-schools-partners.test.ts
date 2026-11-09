/**
 * Integration tests for admin-schools-partners service.
 * Uses the real test database (findmyjob_test via TEST_DATABASE_URL).
 */
import { vi, describe, it, expect, beforeEach } from 'vitest'

vi.mock('@/server/auth', () => ({ getSession: vi.fn(), auth: {} }))
vi.mock('@/server/db', async () => {
  const { testDb } = await import('../setup/db')
  return { db: testDb }
})
vi.mock('server-only', () => ({}))
vi.mock('@/server/services/audit', () => ({ logAudit: vi.fn().mockResolvedValue(undefined) }))

import { setupTestDb, testDb } from '../setup/db'
import {
  listSchools,
  getSchool,
  createSchool,
  updateSchool,
  listPartners,
  getPartner,
  createPartner,
  updatePartner,
  deletePartner,
  getHomePartners,
  isPartnerLogoKey,
  createPartnerSchema,
  updatePartnerSchema,
  createSchoolSchema,
} from '@/server/services/admin-schools-partners'
import { ForbiddenError, NotFoundError } from '@/server/errors'

setupTestDb()

function uid() {
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

async function mkAdmin() {
  return testDb.user.create({
    data: {
      name: 'Admin',
      email: `admin-${uid()}@example.test`,
      emailVerified: true,
      role: 'ADMIN',
      status: 'ACTIVE',
    },
  })
}

async function mkStudent() {
  return testDb.user.create({
    data: {
      name: 'Student',
      email: `student-${uid()}@example.test`,
      emailVerified: true,
      role: 'STUDENT',
      status: 'ACTIVE',
    },
  })
}

beforeEach(() => {
  vi.clearAllMocks()
})

// ==================== isPartnerLogoKey ====================

describe('isPartnerLogoKey', () => {
  it('returns true for valid prefix', () => {
    expect(isPartnerLogoKey('partner-logos/acme/abc12345-0000-0000-0000-000000000001.png')).toBe(true)
    expect(isPartnerLogoKey('partner-logos/uni-malaya/abc12345-0000-0000-0000-000000000001.jpg')).toBe(true)
  })
  it('returns false for other prefix', () => {
    expect(isPartnerLogoKey('logos/abc/file.png')).toBe(false)
    expect(isPartnerLogoKey('')).toBe(false)
  })
  it('returns false for non-uuid filename', () => {
    expect(isPartnerLogoKey('partner-logos/abc/file.png')).toBe(false)
    expect(isPartnerLogoKey('partner-logos/abc/../../etc/passwd')).toBe(false)
  })
})

// ==================== School CRUD ====================

describe('createSchool', () => {
  it('admin can create a school', async () => {
    const admin = await mkAdmin()
    const result = await createSchool(
      { userId: admin.id },
      {
        nameZh: `测试大学${uid()}`,
        nameEn: `Test University ${uid()}`,
        emailDomains: [`test-${uid()}.edu.my`],
        country: 'MY',
        isPartner: false,
      },
    )
    expect(result.id).toBeTruthy()
  })

  it('non-admin is rejected with ForbiddenError', async () => {
    const student = await mkStudent()
    await expect(
      createSchool(
        { userId: student.id },
        {
          nameZh: '测试',
          nameEn: 'Test',
          emailDomains: ['x.edu.my'],
          country: 'MY',
          isPartner: false,
        },
      ),
    ).rejects.toThrow(ForbiddenError)
  })
})

describe('listSchools', () => {
  it('admin can list schools', async () => {
    const admin = await mkAdmin()
    await createSchool(
      { userId: admin.id },
      {
        nameZh: `列表测试大学${uid()}`,
        nameEn: `List University ${uid()}`,
        emailDomains: [`list-${uid()}.edu.my`],
        country: 'MY',
        isPartner: false,
      },
    )
    const list = await listSchools({ userId: admin.id })
    expect(Array.isArray(list)).toBe(true)
  })

  it('non-admin is rejected', async () => {
    const student = await mkStudent()
    await expect(listSchools({ userId: student.id })).rejects.toThrow(ForbiddenError)
  })
})

describe('getSchool', () => {
  it('returns school for admin', async () => {
    const admin = await mkAdmin()
    const { id } = await createSchool(
      { userId: admin.id },
      {
        nameZh: `获取测试${uid()}`,
        nameEn: `Get Test ${uid()}`,
        emailDomains: [`get-${uid()}.edu.my`],
        country: 'MY',
        isPartner: false,
      },
    )
    const school = await getSchool({ userId: admin.id }, id)
    expect(school.id).toBe(id)
    expect(school.studentCount).toBe(0)
  })

  it('throws NotFoundError for unknown id', async () => {
    const admin = await mkAdmin()
    await expect(getSchool({ userId: admin.id }, 'clzzzzzzzzzzzzzzzzzzzzzzz')).rejects.toThrow(
      NotFoundError,
    )
  })
})

describe('updateSchool', () => {
  it('admin can update active status', async () => {
    const admin = await mkAdmin()
    const { id } = await createSchool(
      { userId: admin.id },
      {
        nameZh: `更新测试${uid()}`,
        nameEn: `Update Test ${uid()}`,
        emailDomains: [`upd-${uid()}.edu.my`],
        country: 'MY',
        isPartner: false,
      },
    )
    await updateSchool({ userId: admin.id }, id, { active: false })
    const updated = await getSchool({ userId: admin.id }, id)
    expect(updated.active).toBe(false)
  })
})

// ==================== Partner CRUD ====================

describe('createPartner', () => {
  it('admin can create a partner', async () => {
    const admin = await mkAdmin()
    const result = await createPartner(
      { userId: admin.id },
      {
        name: `Partner ${uid()}`,
        type: 'ENTERPRISE',
        showOnHome: true,
        sortOrder: 0,
      },
    )
    expect(result.id).toBeTruthy()
  })

  it('non-admin is rejected', async () => {
    const student = await mkStudent()
    await expect(
      createPartner(
        { userId: student.id },
        { name: 'x', type: 'ENTERPRISE', showOnHome: false, sortOrder: 0 },
      ),
    ).rejects.toThrow(ForbiddenError)
  })
})

describe('listPartners', () => {
  it('admin can list partners', async () => {
    const admin = await mkAdmin()
    const list = await listPartners({ userId: admin.id })
    expect(Array.isArray(list)).toBe(true)
  })

  it('non-admin is rejected', async () => {
    const student = await mkStudent()
    await expect(listPartners({ userId: student.id })).rejects.toThrow(ForbiddenError)
  })
})

describe('getPartner', () => {
  it('returns partner for admin', async () => {
    const admin = await mkAdmin()
    const { id } = await createPartner(
      { userId: admin.id },
      { name: `GetPart ${uid()}`, type: 'NGO', showOnHome: false, sortOrder: 1 },
    )
    const partner = await getPartner({ userId: admin.id }, id)
    expect(partner.id).toBe(id)
  })

  it('throws NotFoundError for unknown id', async () => {
    const admin = await mkAdmin()
    await expect(getPartner({ userId: admin.id }, 'clzzzzzzzzzzzzzzzzzzzzzzz')).rejects.toThrow(
      NotFoundError,
    )
  })
})

describe('updatePartner', () => {
  it('admin can toggle showOnHome', async () => {
    const admin = await mkAdmin()
    const { id } = await createPartner(
      { userId: admin.id },
      { name: `UpdPart ${uid()}`, type: 'SOE', showOnHome: true, sortOrder: 0 },
    )
    await updatePartner({ userId: admin.id }, id, { showOnHome: false })
    const updated = await getPartner({ userId: admin.id }, id)
    expect(updated.showOnHome).toBe(false)
  })
})

describe('deletePartner', () => {
  it('admin can delete a partner', async () => {
    const admin = await mkAdmin()
    const { id } = await createPartner(
      { userId: admin.id },
      { name: `DelPart ${uid()}`, type: 'GOVERNMENT', showOnHome: false, sortOrder: 99 },
    )
    await deletePartner({ userId: admin.id }, id)
    await expect(getPartner({ userId: admin.id }, id)).rejects.toThrow(NotFoundError)
  })

  it('non-admin is rejected', async () => {
    const student = await mkStudent()
    await expect(deletePartner({ userId: student.id }, 'clzzzzzzzzzzzzzzzzzzzzzzz')).rejects.toThrow(
      ForbiddenError,
    )
  })
})

// ==================== Public ====================

describe('getHomePartners', () => {
  it('returns only showOnHome=true partners ordered by sortOrder', async () => {
    const admin = await mkAdmin()
    const suffix = uid()
    // Create two: one shown, one hidden
    await createPartner(
      { userId: admin.id },
      { name: `HomePart-B-${suffix}`, type: 'ENTERPRISE', showOnHome: true, sortOrder: 10 },
    )
    await createPartner(
      { userId: admin.id },
      { name: `HomePart-A-${suffix}`, type: 'ENTERPRISE', showOnHome: true, sortOrder: 5 },
    )
    await createPartner(
      { userId: admin.id },
      { name: `HiddenPart-${suffix}`, type: 'ENTERPRISE', showOnHome: false, sortOrder: 0 },
    )

    const list = await getHomePartners()
    // All results must have showOnHome=true
    expect(list.every((p) => p.showOnHome)).toBe(true)
    // HiddenPart must not appear
    expect(list.some((p) => p.name === `HiddenPart-${suffix}`)).toBe(false)
    // A appears before B (lower sortOrder)
    const aIdx = list.findIndex((p) => p.name === `HomePart-A-${suffix}`)
    const bIdx = list.findIndex((p) => p.name === `HomePart-B-${suffix}`)
    expect(aIdx).toBeGreaterThanOrEqual(0)
    expect(bIdx).toBeGreaterThanOrEqual(0)
    expect(aIdx).toBeLessThan(bIdx)
  })
})

// ==================== Concurrent writes ====================

describe('concurrent partner creates', () => {
  it('concurrent creates produce distinct records (no data corruption)', async () => {
    const admin = await mkAdmin()
    const suffix = uid()

    const results = await Promise.all(
      Array.from({ length: 5 }, (_, i) =>
        createPartner(
          { userId: admin.id },
          { name: `Concurrent-${i}-${suffix}`, type: 'ENTERPRISE', showOnHome: false, sortOrder: i },
        ),
      ),
    )

    // All 5 creates should succeed with distinct IDs
    const ids = results.map((r) => r.id)
    expect(new Set(ids).size).toBe(5)
  })
})

// ==================== M6-T11: partner website validation ====================

describe('partner website validation (M6-T11)', () => {
  it('javascript: URL is rejected in createPartner schema', () => {
    const result = createPartnerSchema.safeParse({
      name: 'Test',
      type: 'ENTERPRISE',
      showOnHome: false,
      sortOrder: 0,
      website: 'javascript:alert(1)',
    })
    expect(result.success).toBe(false)
  })

  it('ftp: URL is rejected in createPartner schema', () => {
    const result = createPartnerSchema.safeParse({
      name: 'Test',
      type: 'ENTERPRISE',
      showOnHome: false,
      sortOrder: 0,
      website: 'ftp://files.example.com',
    })
    expect(result.success).toBe(false)
  })

  it('https URL is accepted in createPartner schema', () => {
    const result = createPartnerSchema.safeParse({
      name: 'Test',
      type: 'ENTERPRISE',
      showOnHome: false,
      sortOrder: 0,
      website: 'https://example.com',
    })
    expect(result.success).toBe(true)
  })

  it('http URL is accepted in createPartner schema', () => {
    const result = createPartnerSchema.safeParse({
      name: 'Test',
      type: 'ENTERPRISE',
      showOnHome: false,
      sortOrder: 0,
      website: 'http://example.com',
    })
    expect(result.success).toBe(true)
  })

  it('website: "" clears to null after updatePartner', async () => {
    const admin = await mkAdmin()
    const { id } = await createPartner(
      { userId: admin.id },
      { name: `WebsiteNull-${uid()}`, type: 'ENTERPRISE', showOnHome: false, sortOrder: 0, website: 'https://example.com' },
    )
    await updatePartner({ userId: admin.id }, id, { website: '' })
    const updated = await getPartner({ userId: admin.id }, id)
    expect(updated.website).toBeNull()
  })

  it('nameEn: "" clears to null after updatePartner', async () => {
    const admin = await mkAdmin()
    const { id } = await createPartner(
      { userId: admin.id },
      { name: `NameEnNull-${uid()}`, type: 'ENTERPRISE', showOnHome: false, sortOrder: 0, nameEn: 'English Name' },
    )
    await updatePartner({ userId: admin.id }, id, { nameEn: '' })
    const updated = await getPartner({ userId: admin.id }, id)
    expect(updated.nameEn).toBeNull()
  })
})

// ==================== M6-T11: logoKey validation ====================

describe('partner logoKey validation (M6-T11)', () => {
  it('invalid logoKey is rejected in schema', () => {
    const result = updatePartnerSchema.safeParse({ logoKey: 'evil/../../../etc/passwd.png' })
    expect(result.success).toBe(false)
  })

  it('valid logoKey passes schema', () => {
    const result = updatePartnerSchema.safeParse({
      logoKey: 'partner-logos/acme/abc12345-0000-0000-0000-000000000001.png',
    })
    expect(result.success).toBe(true)
  })

  it('empty logoKey clears to null after updatePartner', async () => {
    const admin = await mkAdmin()
    const { id } = await createPartner(
      { userId: admin.id },
      {
        name: `LogoNull-${uid()}`,
        type: 'ENTERPRISE',
        showOnHome: false,
        sortOrder: 0,
        logoKey: 'partner-logos/acme/abc12345-0000-0000-0000-000000000001.png',
      },
    )
    await updatePartner({ userId: admin.id }, id, { logoKey: '' })
    const updated = await getPartner({ userId: admin.id }, id)
    expect(updated.logoKey).toBeNull()
  })
})

// ==================== M6-T11: emailDomains normalization ====================

describe('school emailDomains normalization (M6-T11)', () => {
  it('uppercase and spaces in domain are trimmed and lowercased', () => {
    const result = createSchoolSchema.safeParse({
      nameZh: '测试大学',
      nameEn: 'Test University',
      emailDomains: ['  XMU.EDU.MY  ', ' EXAMPLE.COM'],
      country: 'MY',
      isPartner: false,
    })
    expect(result).toMatchObject({
      success: true,
      data: { emailDomains: ['xmu.edu.my', 'example.com'] },
    })
  })

  it('invalid domain format is rejected', () => {
    const result = createSchoolSchema.safeParse({
      nameZh: '测试大学',
      nameEn: 'Test University',
      emailDomains: ['not-a-domain'],
      country: 'MY',
      isPartner: false,
    })
    expect(result.success).toBe(false)
  })

  it('domain without TLD is rejected', () => {
    const result = createSchoolSchema.safeParse({
      nameZh: '测试大学',
      nameEn: 'Test University',
      emailDomains: ['localdomain'],
      country: 'MY',
      isPartner: false,
    })
    expect(result.success).toBe(false)
  })

  it('valid domain passes schema', () => {
    const result = createSchoolSchema.safeParse({
      nameZh: '测试大学',
      nameEn: 'Test University',
      emailDomains: ['xmu.edu.my'],
      country: 'MY',
      isPartner: false,
    })
    expect(result.success).toBe(true)
  })
})
