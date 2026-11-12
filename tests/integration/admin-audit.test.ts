/**
 * Integration tests for admin-audit service (M6-T06).
 *
 * Verifies:
 *  1. All AUDIT_ACTIONS can be queried via listAuditLogs
 *  2. Real business functions trigger correct audit rows
 *  3. All filter dimensions work correctly
 *  4. KL date boundary: previous-day 23:59 not included in dateFrom
 *  5. Pagination is non-overlapping and non-dropping
 *  6. Metadata sanitization hides PII keys and values
 */
import { vi, describe, it, expect, beforeEach } from 'vitest'

vi.mock('@/server/db', async () => {
  const { testDb } = await import('../setup/db')
  return { db: testDb }
})
vi.mock('@/server/auth', () => ({ getSession: vi.fn(), auth: {} }))

import { setupTestDb, testDb } from '../setup/db'
import { createStudent, createEmployer, createAdmin } from '../factories'
import { AUDIT_ACTIONS } from '@/server/lib/audit-actions'
import { listAuditLogs, sanitizeAuditMetadata } from '@/server/services/admin-audit'
import { ForbiddenError } from '@/server/errors'
import { addBlockedCompany, removeBlockedCompany } from '@/server/services/privacy'
import { getContactForCompany } from '@/server/services/contact-access'
import { updateSettingAdmin } from '@/server/services/admin-settings'
import { encryptField } from '@/server/lib/crypto'

setupTestDb()

// KL is UTC+8 year-round
const KL_OFFSET_MS = 8 * 60 * 60 * 1000

function klMidnightUtc(dateStr: string): Date {
  return new Date(dateStr + 'T00:00:00+08:00')
}

function todayKLStr(): string {
  const nowKL = new Date(Date.now() + KL_OFFSET_MS)
  return nowKL.toISOString().slice(0, 10)
}

// ---- Helpers ----------------------------------------------------------------

async function mkAdmin() {
  return createAdmin(testDb)
}

async function verifyCompany(companyId: string) {
  return testDb.company.update({
    where: { id: companyId },
    data: { verificationStatus: 'VERIFIED', isActive: true },
  })
}

async function createUnlock(companyId: string, studentId: string, unlockedById: string) {
  await testDb.creditWallet.upsert({
    where: { companyId },
    create: { companyId, balance: 10 },
    update: {},
  })
  return testDb.talentUnlock.create({
    data: { companyId, studentId, unlockedById, source: 'CREDIT', creditsSpent: 1 },
  })
}

function encPhone(val: string, studentId: string): string {
  return encryptField(val, `StudentContact.phone:${studentId}`)
}

// ---- Tests ------------------------------------------------------------------

describe('M6-T08 content actions appear in the admin audit query', () => {
  it('queries actual article and synonym saves with safe metadata', async () => {
    const { userId } = await createAdmin(testDb)
    const { saveArticle } = await import('@/server/services/articles')
    const { saveSynonymGroup } = await import('@/server/services/search-synonyms')
    const article = await saveArticle({ userId }, {
      category: 'GUIDE', title: 'Synthetic audit guide',
      body: 'audit-private-body-sentinel', sortOrder: 0, published: false,
    })
    const synonym = await saveSynonymGroup({ userId }, {
      terms: ['audit-private-term-alpha', 'audit-private-term-beta'], active: true,
    })
    for (const expected of [
      { action: 'article.save', targetType: 'Article', targetId: article.id },
      { action: 'search.synonym.save', targetType: 'SearchSynonymGroup', targetId: synonym.id },
    ]) {
      const { items } = await listAuditLogs({ userId }, { action: expected.action })
      expect(items).toHaveLength(1)
      expect(items[0]).toMatchObject({ ...expected, actorId: userId })
      const serialized = JSON.stringify(items[0].metadata)
      expect(serialized).not.toContain('audit-private-body-sentinel')
      expect(serialized).not.toContain('audit-private-term-alpha')
      expect(serialized).not.toContain('audit-private-term-beta')
    }
  })
})

describe('listAuditLogs: all AUDIT_ACTIONS can be queried', () => {
  it('every action from AUDIT_ACTIONS can be found via listAuditLogs', async () => {
    const { userId } = await mkAdmin()

    // Insert one row per action
    for (const action of AUDIT_ACTIONS) {
      await testDb.auditLog.create({
        data: {
          actorId: userId,
          action,
          targetType: 'Test',
          metadata: {},
        },
      })
    }

    // Query each action individually
    for (const action of AUDIT_ACTIONS) {
      const { items } = await listAuditLogs({ userId }, { action })
      expect(items.some((i) => i.action === action), `action "${action}" should be found`).toBe(true)
    }
  })
})

describe('listAuditLogs: real business functions', () => {
  it('block and unblock company write correct audit rows', async () => {
    const { userId, profileId } = await createStudent(testDb)
    const emp = await createEmployer(testDb)
    await verifyCompany(emp.companyId)
    const { userId: adminId } = await mkAdmin()

    await addBlockedCompany({ userId }, { companyId: emp.companyId })
    await removeBlockedCompany({ userId }, { companyId: emp.companyId })

    const { items: blockItems } = await listAuditLogs(
      { userId: adminId },
      { action: 'student.block_company', actorId: userId },
    )
    expect(blockItems).toHaveLength(1)
    expect(blockItems[0].action).toBe('student.block_company')
    expect(blockItems[0].targetId).toBe(emp.companyId)

    const { items: unblockItems } = await listAuditLogs(
      { userId: adminId },
      { action: 'student.unblock_company', actorId: userId },
    )
    expect(unblockItems).toHaveLength(1)
    expect(unblockItems[0].action).toBe('student.unblock_company')

    // Verify profileId is not leaked in actorEmail/actorName (studentId is in metadata, not in actor fields)
    expect(unblockItems[0].actorEmail).not.toContain(profileId)
  })

  it('getContactForCompany writes contact.read audit row', async () => {
    const { userId: studentUserId, profileId } = await createStudent(testDb)
    const emp = await createEmployer(testDb)
    await verifyCompany(emp.companyId)
    await createUnlock(emp.companyId, profileId, emp.userId)

    // Create encrypted contact
    await testDb.studentContact.create({
      data: {
        studentId: profileId,
        phone: encPhone('+601234567890', profileId),
      },
    })

    await getContactForCompany(emp.companyId, profileId, { userId: emp.userId })

    const { userId: adminId } = await mkAdmin()
    const { items } = await listAuditLogs(
      { userId: adminId },
      { action: 'contact.read', targetType: 'StudentContact', targetId: profileId },
    )
    expect(items).toHaveLength(1)
    expect(items[0].action).toBe('contact.read')
    expect(items[0].targetId).toBe(profileId)
    // Metadata must NOT leak decrypted phone
    expect(JSON.stringify(items[0].metadata)).not.toContain('+601234567890')
  })

  it('updateSettingAdmin writes setting.update audit row with from/to in metadata', async () => {
    const { userId } = await mkAdmin()
    await updateSettingAdmin({ userId }, 'unlock.costCredits', 2)

    const { items } = await listAuditLogs({ userId }, { action: 'setting.update' })
    expect(items.length).toBeGreaterThanOrEqual(1)
    const auditRow = items.find((i) => {
      const m = i.metadata as Record<string, unknown>
      return m.key === 'unlock.costCredits'
    })
    expect(auditRow).toBeDefined()
    const meta = auditRow!.metadata as Record<string, unknown>
    expect(meta).toHaveProperty('key', 'unlock.costCredits')
    expect(meta).toHaveProperty('to', 2)
    // 'from' might be null/1 (default) depending on prior test state
    expect('from' in meta).toBe(true)
  })
})

describe('listAuditLogs: filters', () => {
  it('action filter returns only matching rows', async () => {
    const { userId } = await mkAdmin()
    await testDb.auditLog.createMany({
      data: [
        { actorId: userId, action: 'auth.login', targetType: 'User', metadata: {} },
        { actorId: userId, action: 'setting.update', targetType: 'SystemSetting', metadata: {} },
      ],
    })

    const { items } = await listAuditLogs({ userId }, { action: 'auth.login' })
    expect(items.every((i) => i.action === 'auth.login')).toBe(true)
    expect(items.some((i) => i.action === 'setting.update')).toBe(false)
  })

  it('actorEmail filter resolves email to actorId and returns only matching rows', async () => {
    const { userId, email } = await mkAdmin()
    const { userId: otherId } = await mkAdmin()

    await testDb.auditLog.createMany({
      data: [
        { actorId: userId, action: 'auth.login', targetType: 'User', metadata: {} },
        { actorId: otherId, action: 'auth.login', targetType: 'User', metadata: {} },
      ],
    })

    const { items } = await listAuditLogs({ userId }, { action: 'auth.login', actorEmail: email })
    expect(items.every((i) => i.actorId === userId)).toBe(true)
    expect(items.some((i) => i.actorId === otherId)).toBe(false)
  })

  it('actorEmail with unknown email returns empty result', async () => {
    const { userId } = await mkAdmin()
    const { items } = await listAuditLogs({ userId }, { actorEmail: 'nobody@example.test' })
    expect(items).toHaveLength(0)
  })

  it('targetType and targetId filter', async () => {
    const { userId } = await mkAdmin()
    await testDb.auditLog.createMany({
      data: [
        { actorId: userId, action: 'contact.read', targetType: 'StudentContact', targetId: 'abc', metadata: {} },
        { actorId: userId, action: 'contact.read', targetType: 'StudentContact', targetId: 'xyz', metadata: {} },
      ],
    })

    const { items } = await listAuditLogs({ userId }, { targetType: 'StudentContact', targetId: 'abc' })
    expect(items).toHaveLength(1)
    expect(items[0].targetId).toBe('abc')
  })

  it('KL date boundary: previous-day 23:59 KL is excluded from dateFrom filter', async () => {
    const { userId } = await mkAdmin()
    const todayKL = todayKLStr()
    const midnightUtc = klMidnightUtc(todayKL)

    // 1 second before KL midnight → should be excluded
    const beforeMidnight = new Date(midnightUtc.getTime() - 1000)
    // 1 second after KL midnight → should be included
    const afterMidnight = new Date(midnightUtc.getTime() + 1000)

    await testDb.auditLog.create({
      data: {
        actorId: userId,
        action: 'auth.login',
        targetType: 'boundary-before',
        metadata: {},
        createdAt: beforeMidnight,
      },
    })
    await testDb.auditLog.create({
      data: {
        actorId: userId,
        action: 'auth.login',
        targetType: 'boundary-after',
        metadata: {},
        createdAt: afterMidnight,
      },
    })

    const { items } = await listAuditLogs({ userId }, { dateFrom: todayKL, action: 'auth.login' })
    const targetTypes = items.map((i) => i.targetType)

    expect(targetTypes).not.toContain('boundary-before')
    expect(targetTypes).toContain('boundary-after')
  })
})

describe('listAuditLogs: pagination', () => {
  it('pages through all rows without duplicates or gaps', async () => {
    const { userId } = await mkAdmin()

    // Insert 55 rows so we need 2 pages (page size = 50)
    const inserts = Array.from({ length: 55 }, (_, i) => ({
      actorId: userId,
      action: 'auth.login',
      targetType: `pagination-test-${String(i).padStart(3, '0')}`,
      metadata: {},
    }))
    // Insert in order; createdAt defaults to now — small sleep for distinct ts values
    for (const row of inserts) {
      await testDb.auditLog.create({ data: row })
    }

    const page1 = await listAuditLogs({ userId }, { action: 'auth.login' })
    expect(page1.items).toHaveLength(50)
    expect(page1.nextCursor).not.toBeNull()

    const page2 = await listAuditLogs({ userId }, { action: 'auth.login', cursor: page1.nextCursor! })
    expect(page2.items).toHaveLength(5)
    expect(page2.nextCursor).toBeNull()

    // No duplicates
    const allIds = [...page1.items, ...page2.items].map((i) => i.id)
    expect(new Set(allIds).size).toBe(55)
  })
})

describe('sanitizeAuditMetadata: PII redaction', () => {
  it('redacts sensitive keys', () => {
    const result = sanitizeAuditMetadata({
      phone: '+60 12-000 0420',
      email: 'leak-sentinel@example.test',
      wechat: 'wx-id-123',
      whatsapp: '+60 11 1234 5678',
      otp: '123456',
      token: 'abc-secret-token',
      password: 'hunter2',
      secret: 'my-secret',
      code: '99999',
      safeKey: 'safe-value',
    })

    expect(result.phone).toBe('***')
    expect(result.email).toBe('***')
    expect(result.wechat).toBe('***')
    expect(result.whatsapp).toBe('***')
    expect(result.otp).toBe('***')
    expect(result.token).toBe('***')
    expect(result.password).toBe('***')
    expect(result.secret).toBe('***')
    expect(result.code).toBe('***')
    expect(result.safeKey).toBe('safe-value')
  })

  it('redacts string values that look like emails', () => {
    const result = sanitizeAuditMetadata({ actorInfo: 'leak-sentinel@example.test' })
    expect(result.actorInfo).toBe('***')
  })

  it('redacts string values that look like phone numbers', () => {
    const result = sanitizeAuditMetadata({ actorInfo: '+60 12-000 0420' })
    expect(result.actorInfo).toBe('***')
  })

  it('redacts sensitive data nested in objects and arrays, and partial key names', () => {
    const out = sanitizeAuditMetadata({
      contact: { phone: '+60 12-000 0420', note: 'leak-sentinel@example.test' },
      list: [{ userEmail: 'someone@example.test' }, { resetToken: 'tok_123' }],
      code: 'reset-otp-9999',
      companyId: 'cmw000000000000000000000',
    })
    const s = JSON.stringify(out)
    for (const leaked of ['+60 12-000 0420', 'leak-sentinel@example.test', 'someone@example.test', 'tok_123', 'reset-otp-9999']) {
      expect(s).not.toContain(leaked)
    }
    // Internal IDs stay readable
    expect(s).toContain('cmw000000000000000000000')
  })

  it('listAuditLogs output does not contain sentinel values planted in metadata', async () => {
    const { userId } = await mkAdmin()

    await testDb.auditLog.create({
      data: {
        actorId: userId,
        action: 'setting.update',
        targetType: 'SystemSetting',
        targetId: 'sentinel-test',
        metadata: {
          phone: '+60 12-000 0420',
          email: 'leak-sentinel@example.test',
          otp: 'sentinel-otp-99999',
          token: 'sentinel-token-xyz',
        } as never,
      },
    })

    const { items } = await listAuditLogs({ userId }, { targetType: 'SystemSetting', targetId: 'sentinel-test' })
    expect(items).toHaveLength(1)

    const metaStr = JSON.stringify(items[0].metadata)
    expect(metaStr).not.toContain('+60 12-000 0420')
    expect(metaStr).not.toContain('leak-sentinel@example.test')
    expect(metaStr).not.toContain('sentinel-otp-99999')
    expect(metaStr).not.toContain('sentinel-token-xyz')
  })
})

describe('listAuditLogs: access control', () => {
  it('non-admin user gets ForbiddenError', async () => {
    const { userId } = await createStudent(testDb)
    await expect(listAuditLogs({ userId }, {})).rejects.toBeInstanceOf(ForbiddenError)
  })

  it('employer gets ForbiddenError', async () => {
    const { userId } = await createEmployer(testDb)
    await expect(listAuditLogs({ userId }, {})).rejects.toBeInstanceOf(ForbiddenError)
  })
})
