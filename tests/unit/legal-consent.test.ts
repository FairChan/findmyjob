import { vi, describe, it, expect, beforeEach } from 'vitest'

vi.mock('@/server/db', () => ({
  db: {
    systemSetting: { findUnique: vi.fn() },
    consent: { findFirst: vi.fn(), create: vi.fn() },
    auditLog: { create: vi.fn() },
    $transaction: vi.fn((ops: unknown[]) => Promise.all(ops)),
  },
}))

const { needsReconsent, recordLegalConsent } = await import(
  '@/server/services/legal-consent'
)
const { db } = await import('@/server/db')

const mockConsentFindFirst = vi.mocked(db.consent.findFirst)
const mockSettingFindUnique = vi.mocked(db.systemSetting.findUnique)
const mockConsentCreate = vi.mocked(db.consent.create)
const mockAuditCreate = vi.mocked(db.auditLog.create)

const CURRENT_VERSION = '2026-11-draft'

beforeEach(() => {
  vi.clearAllMocks()
  mockSettingFindUnique.mockResolvedValue({
    key: 'legal.currentVersion',
    value: CURRENT_VERSION,
    updatedById: null,
    updatedAt: new Date(),
  })
})

describe('needsReconsent', () => {
  it('returns false when user has consented to both TERMS and PRIVACY at current version', async () => {
    mockConsentFindFirst.mockResolvedValue({
      id: 'c1',
      userId: 'u1',
      type: 'TERMS',
      version: CURRENT_VERSION,
      granted: true,
      ip: null,
      userAgent: null,
      createdAt: new Date(),
    })

    const result = await needsReconsent('u1')
    expect(result).toBe(false)
  })

  it('returns true when TERMS consent is missing', async () => {
    mockConsentFindFirst
      .mockResolvedValueOnce(null) // TERMS
      .mockResolvedValueOnce({
        id: 'c2',
        userId: 'u1',
        type: 'PRIVACY',
        version: CURRENT_VERSION,
        granted: true,
        ip: null,
        userAgent: null,
        createdAt: new Date(),
      })

    const result = await needsReconsent('u1')
    expect(result).toBe(true)
  })

  it('returns true when PRIVACY consent is missing', async () => {
    mockConsentFindFirst
      .mockResolvedValueOnce({
        id: 'c3',
        userId: 'u1',
        type: 'TERMS',
        version: CURRENT_VERSION,
        granted: true,
        ip: null,
        userAgent: null,
        createdAt: new Date(),
      })
      .mockResolvedValueOnce(null) // PRIVACY

    const result = await needsReconsent('u1')
    expect(result).toBe(true)
  })

  it('returns true when neither consent exists (new user)', async () => {
    mockConsentFindFirst.mockResolvedValue(null)

    const result = await needsReconsent('u-new')
    expect(result).toBe(true)
  })

  it('returns true when consented to old version only', async () => {
    // DB returns null because version filter does not match old-version records
    mockConsentFindFirst.mockResolvedValue(null)

    const result = await needsReconsent('u-old')
    expect(result).toBe(true)
  })
})

describe('recordLegalConsent', () => {
  it('creates TERMS and PRIVACY consent records and an audit log', async () => {
    mockConsentCreate.mockResolvedValue({} as never)
    mockAuditCreate.mockResolvedValue({} as never)

    await recordLegalConsent('u1', {
      version: CURRENT_VERSION,
      ip: '1.2.3.4',
      userAgent: 'TestBrowser/1.0',
    })

    expect(db.$transaction).toHaveBeenCalledOnce()
    expect(mockAuditCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: 'user.reconsent',
          actorId: 'u1',
          metadata: { version: CURRENT_VERSION },
        }),
      }),
    )
  })
})
