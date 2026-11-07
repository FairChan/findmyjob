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

  it('returns true when no consent records exist (new user)', async () => {
    // No records found — always requires reconsent
    mockConsentFindFirst.mockResolvedValue(null)

    const result = await needsReconsent('u-old')
    expect(result).toBe(true)
  })

  it('returns true when latest TERMS record is granted: false (revocation)', async () => {
    mockConsentFindFirst
      .mockResolvedValueOnce({
        id: 'c5', userId: 'u1', type: 'TERMS', version: CURRENT_VERSION,
        granted: false, ip: null, userAgent: null, createdAt: new Date(),
      })
      .mockResolvedValueOnce({
        id: 'c6', userId: 'u1', type: 'PRIVACY', version: CURRENT_VERSION,
        granted: true, ip: null, userAgent: null, createdAt: new Date(),
      })
    const result = await needsReconsent('u1')
    expect(result).toBe(true)
  })

  it('does not filter query by granted field', async () => {
    mockConsentFindFirst.mockResolvedValue(null)
    await needsReconsent('u-check')
    mockConsentFindFirst.mock.calls.forEach((call) => {
      const whereArg = (call[0] as { where?: Record<string, unknown> })?.where
      expect(whereArg).not.toHaveProperty('granted')
    })
  })

  it('does not filter query by version (checks latest record regardless of version)', async () => {
    mockConsentFindFirst.mockResolvedValue(null)
    await needsReconsent('u-check-version')
    mockConsentFindFirst.mock.calls.forEach((call) => {
      const whereArg = (call[0] as { where?: Record<string, unknown> })?.where
      // Version filter must be absent from the DB query; version is checked on the returned record
      expect(whereArg).not.toHaveProperty('version')
    })
  })

  it('returns true when user revoked consent under a different version', async () => {
    // User granted at v1, then revoked at v1 — but current version is v2.
    // The revocation (granted=false) must be detected even though it is under v1.
    mockConsentFindFirst
      .mockResolvedValueOnce({
        id: 'c-revoke', userId: 'u-rev', type: 'TERMS', version: 'v1',
        granted: false, ip: null, userAgent: null, createdAt: new Date(),
      })
      .mockResolvedValueOnce({
        id: 'c-priv', userId: 'u-rev', type: 'PRIVACY', version: 'v1',
        granted: true, ip: null, userAgent: null, createdAt: new Date(),
      })
    // Current version is v2, so both should require reconsent
    mockSettingFindUnique.mockResolvedValue({
      key: 'legal.currentVersion',
      value: 'v2',
      updatedById: null,
      updatedAt: new Date(),
    })
    const result = await needsReconsent('u-rev')
    expect(result).toBe(true)
  })

  it('returns true when consent version does not match current version', async () => {
    mockConsentFindFirst
      .mockResolvedValueOnce({
        id: 'c-old', userId: 'u-stale', type: 'TERMS', version: 'v1',
        granted: true, ip: null, userAgent: null, createdAt: new Date(),
      })
      .mockResolvedValueOnce({
        id: 'c-priv-old', userId: 'u-stale', type: 'PRIVACY', version: 'v1',
        granted: true, ip: null, userAgent: null, createdAt: new Date(),
      })
    mockSettingFindUnique.mockResolvedValue({
      key: 'legal.currentVersion',
      value: 'v2',
      updatedById: null,
      updatedAt: new Date(),
    })
    const result = await needsReconsent('u-stale')
    expect(result).toBe(true)
  })
})

describe('recordLegalConsent', () => {
  it('creates TERMS and PRIVACY consent records and an audit log', async () => {
    mockConsentCreate.mockResolvedValue({} as never)
    mockAuditCreate.mockResolvedValue({} as never)

    await recordLegalConsent('u1', {
      submittedVersion: CURRENT_VERSION,
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

  it('throws VERSION_MISMATCH when submitted version differs from current', async () => {
    await expect(
      recordLegalConsent('u1', { submittedVersion: 'stale-version' }),
    ).rejects.toMatchObject({ code: 'VERSION_MISMATCH' })
    expect(mockConsentCreate).not.toHaveBeenCalled()
  })

  it('creates two consent records when submitted version matches current', async () => {
    mockConsentCreate.mockResolvedValue({} as never)
    mockAuditCreate.mockResolvedValue({} as never)

    await recordLegalConsent('u2', { submittedVersion: CURRENT_VERSION })

    expect(mockConsentCreate).toHaveBeenCalledTimes(2)
    const types = mockConsentCreate.mock.calls.map(
      (c) => (c[0] as { data: { type: string } }).data.type,
    )
    expect(types).toContain('TERMS')
    expect(types).toContain('PRIVACY')
  })
})
