import { randomUUID } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const mail = vi.hoisted(() => vi.fn())
vi.mock('@/server/db', async () => ({ db: (await import('../helpers/weekly-final-races-t04')).actorDb }))
vi.mock('@/server/jobs/boss', () => ({ sendBoss: { start: vi.fn(), send: vi.fn().mockResolvedValue('synthetic-job') } }))
vi.mock('@/lib/email', async original => ({ ...await original<typeof import('@/lib/email')>(), createEmailProvider: () => ({ sendEmail: mail }) }))
vi.mock('@/server/lib/email-cap', () => ({ checkEmailCap: vi.fn().mockResolvedValue(true) }))
vi.mock('@/server/lib/marketing-disclosure', () => ({ isMarketingDisclosurePublished: vi.fn().mockResolvedValue(true) }))
vi.mock('@/server/lib/ai/embedding-provider', () => ({ embedMatchingText: vi.fn(() => { throw new Error('No external AI') }) }))
vi.mock('@/server/lib/semantic-store', () => ({ isSemanticStoreAvailable: vi.fn().mockResolvedValue(true), writeSemanticVector: vi.fn(), deleteSemanticVector: vi.fn(), findTalentNeighbors: vi.fn().mockResolvedValue([]), findJobNeighbors: vi.fn().mockResolvedValue([]) }))
vi.mock('@/env', async original => {
  const actual = await original<typeof import('@/env')>()
  return { ...actual, env: { ...actual.env, VOYAGE_API_KEY: 'synthetic-key', AI_MODEL_EMBED: 'synthetic-embedding-model', MARKETING_UNSUBSCRIBE_SECRET: 't'.repeat(48) } }
})

import { setupTestDb, testDb } from '../setup/db'
import { raceActors } from '../helpers/weekly-final-races-t04'
import { seedT04Gate, t04StudentRecipient, t04EmployerRecipient, t04Job, t04Talent, t04Queued } from '../helpers/weekly-digest-t04'
import { T03_VERSION } from '../helpers/semantic-matching-t03'
import { sendWeeklyDigestEmail } from '@/server/services/weekly-digest-send'
import { updateMarketingSettingsAdmin, updateMatchingSettingsAdmin, updateSettingAdmin } from '@/server/services/admin-settings'
import { addBlockedCompany, removeBlockedCompany } from '@/server/services/privacy'
import { recordConsents } from '@/server/services/consent'
import { recordLegalConsent } from '@/server/services/legal-consent'
import { clearSettingsCache } from '@/server/services/settings'
import { createAdmin } from '../factories'

setupTestDb()
beforeEach(async () => { vi.clearAllMocks(); clearSettingsCache(); mail.mockResolvedValue(undefined); await seedT04Gate() })
afterEach(() => { vi.useRealTimers() })
async function preparing(userId: string, ids: string[]) {
  const row = await t04Queued(userId), leaseToken = randomUUID()
  await testDb.weeklyDigestDelivery.update({ where: { id: row.id }, data: { state: 'PREPARING', leaseToken, leaseExpiresAt: new Date(Date.now() + 120_000), candidateIds: ids } })
  return { deliveryId: row.id, leaseToken }
}
async function visiblePreparing(deliveryId: string) {
  expect((await testDb.weeklyDigestDelivery.findUniqueOrThrow({ where: { id: deliveryId } })).state).toBe('PREPARING')
  expect(mail).not.toHaveBeenCalled()
}

describe('T04 final transaction configuration rows', () => {
  it.each(['marketing', 'matching', 'legal'] as const)('holds %s admin writer until SENDING commit', async kind => {
    const admin = await createAdmin(testDb), student = await t04StudentRecipient(), job = await t04Job('CONFIG_RACE')
    const input = await preparing(student.userId, [job.item.id]), race = raceActors('job', job.item.id)
    try {
      const send = race.sender(() => sendWeeklyDigestEmail(input))
      await race.entered()
      const write = race.writer(() => kind === 'marketing'
        ? updateMarketingSettingsAdmin(admin, { enabled: false, legalVersion: T03_VERSION })
        : kind === 'matching' ? updateMatchingSettingsAdmin(admin, { enabled: false, legalVersion: T03_VERSION, configurationId: 'matching-public-v1' })
          : updateSettingAdmin(admin, 'legal.currentVersion', 'new-policy'))
      await race.expectWriterBlocked(write)
      await visiblePreparing(input.deliveryId)
      race.release()
      expect(await send).toEqual({ status: 'accepted' })
      await write
      expect(mail).toHaveBeenCalledOnce()
    } finally { await race.close() }
  })
  it.each(['marketing', 'matching', 'legal'] as const)('suppresses when %s admin commits first', async kind => {
    const admin = await createAdmin(testDb), student = await t04StudentRecipient(), job = await t04Job('CONFIG_FIRST')
    const input = await preparing(student.userId, [job.item.id])
    if (kind === 'marketing') await updateMarketingSettingsAdmin(admin, { enabled: false, legalVersion: T03_VERSION })
    else if (kind === 'matching') await updateMatchingSettingsAdmin(admin, { enabled: false, legalVersion: T03_VERSION, configurationId: 'matching-public-v1' })
    else await updateSettingAdmin(admin, 'legal.currentVersion', 'new-policy')
    expect(await sendWeeklyDigestEmail(input)).toEqual({ status: 'suppressed' })
    expect(mail).not.toHaveBeenCalled()
  })
  it.each(['marketing.weekly', 'ai.matching', 'legal.currentVersion'])('fails closed for missing %s row', async key => {
    const student = await t04StudentRecipient(), job = await t04Job('MISSING_SETTING'), input = await preparing(student.userId, [job.item.id])
    await testDb.systemSetting.delete({ where: { key } })
    expect(await sendWeeklyDigestEmail(input)).toEqual({ status: 'suppressed' })
    expect(mail).not.toHaveBeenCalled()
  })
})

describe('T04 source lock writers', () => {
  it.each(['block', 'unblock', 'legal-revoke', 'legal-accept', 'recipient-legal'] as const)('serializes actual %s writer after first talent DTO before second query', async kind => {
    const employer = await t04EmployerRecipient(), first = await t04Talent(), second = await t04Talent()
    const input = await preparing(employer.userId, [first.item.id, second.item.id])
    const race = raceActors('studentProfile', second.item.id)
    try {
      const send = race.sender(() => sendWeeklyDigestEmail(input))
      await race.entered()
      const userId = kind === 'recipient-legal' ? employer.userId : first.student.userId
      const write = race.writer(() => kind === 'block' ? addBlockedCompany(first.student, { companyId: employer.companyId })
        : kind === 'unblock' ? removeBlockedCompany(first.student, { companyId: employer.companyId })
          : kind === 'legal-accept' ? recordLegalConsent(userId, { submittedVersion: T03_VERSION })
            : recordConsents(userId, [{ type: 'PRIVACY', granted: false }], {}))
      await race.expectWriterBlocked(write)
      await visiblePreparing(input.deliveryId)
      race.release()
      expect(await send).toEqual({ status: 'accepted' })
      await write
      expect(JSON.stringify(mail.mock.calls[0][0])).toContain(first.item.id)
    } finally { await race.close() }
  })
  it.each(['block', 'legal-revoke'] as const)('excludes the first talent when %s commits first', async kind => {
    const employer = await t04EmployerRecipient(), first = await t04Talent(), second = await t04Talent()
    const input = await preparing(employer.userId, [first.item.id, second.item.id])
    if (kind === 'block') await addBlockedCompany(first.student, { companyId: employer.companyId })
    else await recordConsents(first.student.userId, [{ type: 'PRIVACY', granted: false }], {})
    expect(await sendWeeklyDigestEmail(input)).toEqual({ status: 'accepted' })
    const message = JSON.stringify(mail.mock.calls[0][0])
    expect(message).not.toContain(first.item.id)
    expect(message).toContain(second.item.id)
  })
  it('appends legal grants/revocations monotonically and reads the fresh version', async () => {
    const student = await t04StudentRecipient()
    await recordConsents(student.userId, [{ type: 'PRIVACY', granted: false }, { type: 'PRIVACY', granted: true }], {})
    const rows = await testDb.consent.findMany({ where: { userId: student.userId, type: 'PRIVACY' }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] })
    expect(rows[0].granted).toBe(true)
    expect(rows[0].createdAt.getTime()).toBeGreaterThan(rows[1].createdAt.getTime())
    await testDb.systemSetting.update({ where: { key: 'legal.currentVersion' }, data: { value: 'fresh-policy' } })
    await expect(recordLegalConsent(student.userId, { submittedVersion: T03_VERSION })).rejects.toThrow()
    await recordConsents(student.userId, [{ type: 'TERMS', granted: false }], {})
    expect((await testDb.consent.findFirstOrThrow({ where: { userId: student.userId, type: 'TERMS' }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] })).version).toBe('fresh-policy')
  })
})

describe('T04 final transition clock', () => {
  it.each(['week', 'lease', 'valid'] as const)('checks %s boundary immediately after the real final query', async boundary => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-11-15T15:59:59.900Z'))
    const student = await t04StudentRecipient(), job = await t04Job('TIME_BOUNDARY'), input = await preparing(student.userId, [job.item.id])
    const leaseExpiresAt = new Date(boundary === 'lease' ? '2026-11-15T15:59:59.950Z' : '2026-11-15T16:01:59.900Z')
    await testDb.weeklyDigestDelivery.update({ where: { id: input.deliveryId }, data: { leaseExpiresAt } })
    const race = raceActors('job', job.item.id)
    try {
      const send = race.sender(() => sendWeeklyDigestEmail(input))
      await race.entered()
      const after = new Date(boundary === 'week' ? '2026-11-15T16:00:00.001Z' : '2026-11-15T15:59:59.975Z')
      vi.setSystemTime(after); race.release()
      expect(await send).toEqual({ status: boundary === 'valid' ? 'accepted' : 'suppressed' })
      const row = await testDb.weeklyDigestDelivery.findUniqueOrThrow({ where: { id: input.deliveryId } })
      expect(mail).toHaveBeenCalledTimes(boundary === 'valid' ? 1 : 0)
      expect(row.leaseExpiresAt).toEqual(boundary === 'valid' ? new Date(after.getTime() + 60_000) : leaseExpiresAt)
      expect(row.state).toBe(boundary === 'valid' ? 'SENDING' : 'PREPARING')
    } finally { await race.close() }
  })
})
