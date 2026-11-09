import { inspect } from 'node:util'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const faults = vi.hoisted(() => ({
  afterAuditInsert: false,
  error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn(),
}))
vi.mock('@/server/auth', () => ({ getSession: vi.fn(), auth: {} }))
vi.mock('@/server/db', async () => {
  const { testDb } = await import('../setup/db')
  return { db: testDb.$extends({ query: { auditLog: {
    async create({ args, query }) {
      const inserted = await query(args)
      if (faults.afterAuditInsert && args.data.targetId === 'billing.bankTransfer') {
        throw new Error('synthetic bank audit failure after insert')
      }
      return inserted
    },
  } } }) }
})
vi.mock('@/server/lib/logger', () => ({ logger: {
  error: faults.error, warn: faults.warn, info: faults.info, debug: faults.debug,
} }))

import { setupTestDb, testDb } from '../setup/db'
import { createAdmin } from '../factories'
import { updateSettingAdmin } from '@/server/services/admin-settings'
import { clearSettingsCache, setSetting } from '@/server/services/settings'

setupTestDb()
const BANK_KEY = 'billing.bankTransfer'
const FIELDS = ['bankName', 'accountName', 'accountNumber', 'instructions'] as const
const FIRST = {
  bankName: 'SYNTHETIC_AUDIT_BANK_811', accountName: 'SYNTHETIC_AUDIT_PAYEE_812',
  accountNumber: '0000000000000813', instructions: 'SYNTHETIC_AUDIT_INSTRUCTIONS_814; TEST ONLY',
}
const SECOND = { ...FIRST, accountNumber: '0000000000000913' }
const EMPTY = { bankName: '', accountName: '', accountNumber: '', instructions: '' }

beforeEach(() => {
  faults.afterAuditInsert = false
  vi.clearAllMocks()
  clearSettingsCache()
})

function leaves(value: unknown): unknown[] {
  if (Array.isArray(value)) return value.flatMap(leaves)
  if (value !== null && typeof value === 'object') return Object.values(value).flatMap(leaves)
  return [value]
}

async function auditRows() {
  return testDb.auditLog.findMany({ where: { action: 'setting.update', targetId: BANK_KEY } })
}

function safeMetadata(metadata: unknown, expectedFields: string[], requiredPresence: boolean[]) {
  // Test semantic content without inventing fromConfigured/toConfigured/changedFields names.
  const content = leaves(metadata)
  const allowed = new Set<string>([BANK_KEY, ...FIELDS])
  expect(content.length).toBeGreaterThan(0)
  expect(content.every(value => typeof value === 'boolean' || (typeof value === 'string' && allowed.has(value)))).toBe(true)
  expect(content.filter(value => typeof value === 'string' && FIELDS.includes(value as typeof FIELDS[number])).sort())
    .toEqual([...expectedFields].sort())
  for (const state of requiredPresence) expect(content).toContain(state)
}

async function assertNoBankLeaks() {
  const rows = await testDb.auditLog.findMany()
  const observations = inspect([rows, faults.error.mock.calls, faults.warn.mock.calls, faults.info.mock.calls, faults.debug.mock.calls], { depth: null })
  for (const value of [...Object.values(FIRST), SECOND.accountNumber]) expect(observations).not.toContain(value)
}

describe('T02 bank configuration audit redaction and atomicity', () => {
  it('stores configured bank data while auditing only presence and field names', async () => {
    const admin = await createAdmin(testDb)
    await updateSettingAdmin(admin, BANK_KEY, FIRST)
    expect(await testDb.systemSetting.findUnique({ where: { key: BANK_KEY } }))
      .toMatchObject({ value: FIRST, updatedById: admin.userId })
    const rows = await auditRows()
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ actorId: admin.userId, action: 'setting.update', targetType: 'SystemSetting', targetId: BANK_KEY })
    safeMetadata(rows[0].metadata, [...FIELDS], [false, true])
    await assertNoBankLeaks()
  })

  it('records the changed field without copying either old or new account number', async () => {
    const admin = await createAdmin(testDb)
    await updateSettingAdmin(admin, BANK_KEY, FIRST)
    const beforeIds = new Set((await auditRows()).map(row => row.id))
    await updateSettingAdmin(admin, BANK_KEY, SECOND)
    expect(await testDb.systemSetting.findUnique({ where: { key: BANK_KEY } })).toMatchObject({ value: SECOND })
    const added = (await auditRows()).filter(row => !beforeIds.has(row.id))
    expect(added).toHaveLength(1)
    safeMetadata(added[0].metadata, ['accountNumber'], [true])
    await assertNoBankLeaks()
  })

  it('accepts fully empty configuration and audits clearing without retaining bank values', async () => {
    const admin = await createAdmin(testDb)
    await updateSettingAdmin(admin, BANK_KEY, FIRST)
    const beforeIds = new Set((await auditRows()).map(row => row.id))
    await updateSettingAdmin(admin, BANK_KEY, EMPTY)
    expect(await testDb.systemSetting.findUnique({ where: { key: BANK_KEY } })).toMatchObject({ value: EMPTY })
    const added = (await auditRows()).filter(row => !beforeIds.has(row.id))
    expect(added).toHaveLength(1)
    safeMetadata(added[0].metadata, [...FIELDS], [true, false])
    await assertNoBankLeaks()
  })

  it('keeps redaction at the shared settings writer so trusted internal calls cannot bypass it', async () => {
    const admin = await createAdmin(testDb)
    await setSetting(BANK_KEY, FIRST, admin.userId)
    const rows = await auditRows()
    expect(rows).toHaveLength(1)
    expect(rows[0].actorId).toBe(admin.userId)
    safeMetadata(rows[0].metadata, [...FIELDS], [false, true])
    await assertNoBankLeaks()
  })

  it('preserves existing scalar setting audit behavior', async () => {
    const admin = await createAdmin(testDb)
    await testDb.systemSetting.create({ data: { key: 'team.maxMembers', value: 3 } })
    await updateSettingAdmin(admin, 'team.maxMembers', 7)
    const rows = await testDb.auditLog.findMany({ where: { action: 'setting.update', targetId: 'team.maxMembers' } })
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ actorId: admin.userId, metadata: { key: 'team.maxMembers', from: 3, to: 7 } })
    expect(await testDb.systemSetting.findUnique({ where: { key: 'team.maxMembers' } })).toMatchObject({ value: 7 })
  })

  it.each(['create', 'replace'] as const)('rolls back bank %s and its inserted audit on audit failure', async operation => {
    const admin = await createAdmin(testDb)
    if (operation === 'replace') await updateSettingAdmin(admin, BANK_KEY, FIRST)
    const before = await testDb.systemSetting.findUnique({ where: { key: BANK_KEY } })
    const beforeAudits = await auditRows()
    faults.afterAuditInsert = true
    try {
      await expect(updateSettingAdmin(admin, BANK_KEY, SECOND)).rejects.toThrow('synthetic bank audit failure after insert')
    } finally {
      faults.afterAuditInsert = false
    }
    expect(await testDb.systemSetting.findUnique({ where: { key: BANK_KEY } })).toEqual(before)
    expect(await auditRows()).toEqual(beforeAudits)
    await assertNoBankLeaks()
    await updateSettingAdmin(admin, BANK_KEY, SECOND)
    expect(await testDb.systemSetting.findUnique({ where: { key: BANK_KEY } })).toMatchObject({ value: SECOND })
    expect(await auditRows()).toHaveLength(beforeAudits.length + 1)
    await assertNoBankLeaks()
  })
})
