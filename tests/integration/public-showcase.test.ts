import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Prisma } from '@prisma/client'

vi.mock('@/server/auth', () => ({ getSession: vi.fn(), auth: {} }))
vi.mock('@/server/db', async () => ({ db: (await import('../setup/db')).testDb }))

import { setupTestDb, testDb } from '../setup/db'
import { DEFAULT_PUBLIC_SHOWCASE, PUBLIC_SHOWCASE_KEY } from '@/schemas/public-showcase'
import { getPublicJobShowcase, getPublicCompanyShowcase, getPublicShowcaseOptions } from '@/server/services/public-showcase'
import { updatePublicShowcaseSettingsAdmin, updateSettingAdmin } from '@/server/services/admin-settings'
import { clearSettingsCache } from '@/server/services/settings'
import { ForbiddenError, NotFoundError, ValidationError } from '@/server/errors'
import * as auditService from '@/server/services/audit'

setupTestDb()
let adminId: string
let companyId: string
beforeEach(async () => {
  clearSettingsCache()
  adminId = (await testDb.user.create({ data: { name: 'Admin', email: 'showcase-admin@example.test', role: 'ADMIN', status: 'ACTIVE', emailVerified: true } })).id
  companyId = (await testDb.company.create({ data: { legalName: 'Showcase employer', verificationStatus: 'VERIFIED', isActive: true } })).id
})

async function job(overrides: Partial<Prisma.JobUncheckedCreateInput> = {}) {
  return testDb.job.create({ data: {
    companyId, createdById: adminId, title: 'Graduate developer', type: 'FULL_TIME',
    description: 'PRIVATE DESCRIPTION MUST NOT LEAK', requirements: 'PRIVATE REQUIREMENTS',
    status: 'PUBLISHED', publishedAt: new Date(), ...overrides,
  } })
}

describe('public showcase database behavior', () => {
  it('excludes unpublished, expired and ineligible-company jobs without backfilling configured selections', async () => {
    const first = await job()
    const second = await job({ title: 'Second' })
    const expired = await job({ deadline: new Date(Date.now() - 1000) })
    const draft = await job({ status: 'DRAFT' })
    const inactive = await testDb.company.create({ data: { legalName: 'Inactive', verificationStatus: 'VERIFIED', isActive: false } })
    const unverified = await testDb.company.create({ data: { legalName: 'Unverified', verificationStatus: 'UNSUBMITTED' } })
    const hidden1 = await job({ companyId: inactive.id })
    const hidden2 = await job({ companyId: unverified.id })
    await job({ title: 'Unselected fallback' })
    await updatePublicShowcaseSettingsAdmin({ userId: adminId }, { ...DEFAULT_PUBLIC_SHOWCASE, jobIds: [second.id, expired.id, draft.id, hidden1.id, hidden2.id, first.id] })
    const result = await getPublicJobShowcase()
    expect(result.items.map(row => row.id)).toEqual([second.id, first.id])
    expect(JSON.stringify(result)).not.toContain('PRIVATE')
  })
  it('bounds automatic fallback at six and returns empty for an explicitly invalid selection', async () => {
    for (let index = 0; index < 8; index++) await job({ title: `Job ${index}` })
    expect((await getPublicJobShowcase()).items).toHaveLength(6)
    await updatePublicShowcaseSettingsAdmin({ userId: adminId }, { ...DEFAULT_PUBLIC_SHOWCASE, jobIds: ['missing'] })
    expect((await getPublicJobShowcase()).items).toEqual([])
    await testDb.systemSetting.update({ where: { key: PUBLIC_SHOWCASE_KEY }, data: { value: { jobIds: 'malformed' } } })
    expect((await getPublicJobShowcase()).items).toHaveLength(6)
  })
  it('preserves company ordering while excluding inactive and unverified companies', async () => {
    const second = await testDb.company.create({ data: { legalName: 'Second', verificationStatus: 'VERIFIED' } })
    const hidden = await testDb.company.create({ data: { legalName: 'Hidden', verificationStatus: 'UNSUBMITTED' } })
    await updatePublicShowcaseSettingsAdmin({ userId: adminId }, { ...DEFAULT_PUBLIC_SHOWCASE, companyIds: [second.id, hidden.id, companyId] })
    expect((await getPublicCompanyShowcase()).items.map(row => row.id)).toEqual([second.id, companyId])
    const options = await getPublicShowcaseOptions({ userId: adminId })
    expect(options.companies.map(row => row.id)).not.toContain(hidden.id)
  })
  it('audits the dedicated writer and rejects non-admin, malformed and generic writes', async () => {
    await updatePublicShowcaseSettingsAdmin({ userId: adminId }, DEFAULT_PUBLIC_SHOWCASE)
    const audit = await testDb.auditLog.findFirst({ where: { targetId: PUBLIC_SHOWCASE_KEY } })
    expect(audit?.action).toBe('setting.update')
    expect(audit?.actorId).toBe(adminId)
    await expect(updatePublicShowcaseSettingsAdmin({ userId: adminId }, { ...DEFAULT_PUBLIC_SHOWCASE, jobIds: Array(13).fill('a') })).rejects.toThrow(ValidationError)
    await expect(updateSettingAdmin({ userId: adminId }, PUBLIC_SHOWCASE_KEY, DEFAULT_PUBLIC_SHOWCASE)).rejects.toThrow(NotFoundError)
    await testDb.user.update({ where: { id: adminId }, data: { role: 'STUDENT' } })
    await expect(updatePublicShowcaseSettingsAdmin({ userId: adminId }, DEFAULT_PUBLIC_SHOWCASE)).rejects.toThrow(ForbiddenError)
    await expect(getPublicShowcaseOptions({ userId: adminId })).rejects.toThrow(ForbiddenError)
  })
  it('rolls back the setting if its audit cannot be recorded', async () => {
    const audit = vi.spyOn(auditService, 'logAudit').mockRejectedValueOnce(new Error('Audit unavailable'))
    try {
      await expect(updatePublicShowcaseSettingsAdmin({ userId: adminId }, DEFAULT_PUBLIC_SHOWCASE)).rejects.toThrow('Audit unavailable')
      expect(await testDb.systemSetting.findUnique({ where: { key: PUBLIC_SHOWCASE_KEY } })).toBeNull()
    } finally { audit.mockRestore() }
  })
})
