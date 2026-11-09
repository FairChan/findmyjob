import { beforeEach, describe, expect, it, vi } from 'vitest'

const faults = vi.hoisted(() => ({ afterAuditInsert: false }))
vi.mock('@/server/auth', () => ({ getSession: vi.fn(), auth: {} }))
vi.mock('@/server/db', async () => {
  const { testDb } = await import('../setup/db')
  return { db: testDb.$extends({ query: { auditLog: {
    async create({ args, query }) {
      const inserted = await query(args)
      if (faults.afterAuditInsert && args.data.targetId === 'billing.invoiceIssuer') {
        throw new Error('synthetic issuer audit failure after insert')
      }
      return inserted
    },
  } } }) }
})

import { setupTestDb, testDb } from '../setup/db'
import { createAdmin } from '../factories'
import { getAllSettings, updateSettingAdmin } from '@/server/services/admin-settings'
import { clearSettingsCache, getSetting, setSetting } from '@/server/services/settings'
import { EMPTY_INVOICE_ISSUER } from '@/server/lib/invoice-settings'
import { ForbiddenError, ValidationError } from '@/server/errors'

setupTestDb()
const KEY = 'billing.invoiceIssuer'
const FIRST = {
  schemaVersion: 1,
  version: ' SYNTHETIC_ISSUER_VERSION_801 ',
  legalName: '  SYNTHETIC_ISSUER_802 法定 & Co  ',
  address: '  SYNTHETIC_ADDRESS_803\nSuite 2  ',
  registrationNo: '00000804',
}
const SECOND = { ...FIRST, version: 'SYNTHETIC_ISSUER_VERSION_805', address: 'SYNTHETIC_ADDRESS_806' }
const FIELDS = ['schemaVersion', 'version', 'legalName', 'address', 'registrationNo']
beforeEach(() => { faults.afterAuditInsert = false; clearSettingsCache() })
const stored = () => testDb.systemSetting.findUnique({ where: { key: KEY } })
const audits = () => testDb.auditLog.findMany({ where: { action: 'setting.update', targetId: KEY }, orderBy: { id: 'asc' } })

describe('invoice issuer administration', () => {
  it('exposes the empty default and saves legal text without changing it', async () => {
    const admin = await createAdmin(testDb)
    expect((await getAllSettings(admin)).find(row => row.key === KEY)).toMatchObject({
      key: KEY, group: 'billing', currentValue: EMPTY_INVOICE_ISSUER, defaultValue: EMPTY_INVOICE_ISSUER,
    })
    expect(await getSetting(KEY, EMPTY_INVOICE_ISSUER)).toEqual(EMPTY_INVOICE_ISSUER)
    await updateSettingAdmin(admin, KEY, FIRST)
    expect(await stored()).toMatchObject({ value: FIRST, updatedById: admin.userId })
    expect(await getSetting(KEY, EMPTY_INVOICE_ISSUER)).toEqual(FIRST)
    expect((await getAllSettings(admin)).find(row => row.key === KEY)?.currentValue).toEqual(FIRST)
  })

  it('audits only configured state and changed field names when saving, replacing and clearing', async () => {
    const admin = await createAdmin(testDb)
    await updateSettingAdmin(admin, KEY, FIRST)
    expect((await audits())[0]).toMatchObject({ actorId: admin.userId, metadata: {
      key: KEY, fromConfigured: false, toConfigured: true, changedFields: FIELDS,
    } })
    const firstIds = new Set((await audits()).map(row => row.id))
    await updateSettingAdmin(admin, KEY, SECOND)
    expect((await audits()).filter(row => !firstIds.has(row.id))[0].metadata).toEqual({
      key: KEY, fromConfigured: true, toConfigured: true, changedFields: ['version', 'address'],
    })
    const beforeClearIds = new Set((await audits()).map(row => row.id))
    await updateSettingAdmin(admin, KEY, EMPTY_INVOICE_ISSUER)
    expect(await stored()).toMatchObject({ value: EMPTY_INVOICE_ISSUER })
    expect((await audits()).filter(row => !beforeClearIds.has(row.id))[0].metadata).toEqual({
      key: KEY, fromConfigured: true, toConfigured: false,
      changedFields: ['version', 'legalName', 'address', 'registrationNo'],
    })
    const metadata = JSON.stringify((await audits()).map(row => row.metadata))
    for (const text of [...Object.values(FIRST), ...Object.values(SECOND)].filter(value => typeof value === 'string')) {
      expect(metadata).not.toContain(text)
    }
  })

  it('also redacts direct settings writes and does not copy malformed historical values', async () => {
    const admin = await createAdmin(testDb)
    await testDb.systemSetting.create({ data: { key: KEY, value: { privateLegacy: 'SYNTHETIC_PRIVATE_LEGACY' } } })
    await setSetting(KEY, FIRST, admin.userId)
    expect((await audits())[0].metadata).toEqual({ key: KEY, fromConfigured: false, toConfigured: true, changedFields: FIELDS })
    expect(JSON.stringify(await audits())).not.toContain('SYNTHETIC_PRIVATE_LEGACY')
    expect(JSON.stringify(await audits())).not.toContain(FIRST.legalName)
  })

  it('rejects partial, oversized and unexpected fields without changing settings or audit rows', async () => {
    const admin = await createAdmin(testDb)
    await updateSettingAdmin(admin, KEY, FIRST)
    const before = await stored()
    const beforeAudits = await audits()
    for (const invalid of [
      { ...FIRST, address: '' }, { ...FIRST, legalName: 'x'.repeat(201) },
      { ...FIRST, schemaVersion: 2 }, { ...FIRST, taxRate: 0 },
    ]) await expect(updateSettingAdmin(admin, KEY, invalid)).rejects.toThrow(ValidationError)
    expect(await stored()).toEqual(before)
    expect(await audits()).toEqual(beforeAudits)
  })

  it.each(['demoted', 'suspended', 'missing'] as const)('rejects a %s administrator using current persisted identity', async state => {
    const admin = await createAdmin(testDb)
    if (state === 'demoted') await testDb.user.update({ where: { id: admin.userId }, data: { role: 'EMPLOYER' } })
    if (state === 'suspended') await testDb.user.update({ where: { id: admin.userId }, data: { status: 'SUSPENDED' } })
    const ctx = state === 'missing' ? { userId: 'synthetic-missing-admin' } : admin
    await expect(updateSettingAdmin(ctx, KEY, FIRST)).rejects.toThrow(ForbiddenError)
    await expect(getAllSettings(ctx)).rejects.toThrow(ForbiddenError)
    expect(await stored()).toBeNull()
    expect(await audits()).toHaveLength(0)
  })

  it.each(['create', 'replace'] as const)('rolls back %s and the inserted audit on an audit failure', async operation => {
    const admin = await createAdmin(testDb)
    if (operation === 'replace') await updateSettingAdmin(admin, KEY, FIRST)
    const before = await stored()
    const beforeAudits = await audits()
    faults.afterAuditInsert = true
    try {
      await expect(updateSettingAdmin(admin, KEY, SECOND)).rejects.toThrow('synthetic issuer audit failure after insert')
    } finally { faults.afterAuditInsert = false }
    expect(await stored()).toEqual(before)
    expect(await audits()).toEqual(beforeAudits)
    await updateSettingAdmin(admin, KEY, SECOND)
    expect(await stored()).toMatchObject({ value: SECOND })
    expect(await audits()).toHaveLength(beforeAudits.length + 1)
  })
})
