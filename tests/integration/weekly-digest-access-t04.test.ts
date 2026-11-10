import { beforeEach, describe, expect, it, vi } from 'vitest'
// Isolate only the human publication prerequisite, preserving actual state/provider seams.
vi.mock('@/server/lib/marketing-disclosure', () => ({ isMarketingDisclosurePublished: vi.fn().mockResolvedValue(true) }))
const mail = vi.hoisted(() => vi.fn())
vi.mock('@/server/db', async () => ({ db: (await import('../setup/db')).testDb }))
vi.mock('@/server/jobs/boss', () => ({ sendBoss: { start: vi.fn(), send: vi.fn().mockResolvedValue('synthetic-queue-job') } }))
vi.mock('@/lib/email', async original => ({ ...await original<typeof import('@/lib/email')>(), createEmailProvider: () => ({ sendEmail: mail }) }))
vi.mock('@/server/lib/email-cap', async original => ({ ...await original<typeof import('@/server/lib/email-cap')>(), checkEmailCap: vi.fn().mockResolvedValue(true) }))
vi.mock('@/server/lib/ai/embedding-provider', () => ({ embedMatchingText: vi.fn(() => { throw new Error('No real AI in weekly tests') }) }))
vi.mock('@/server/lib/semantic-store', () => ({
  isSemanticStoreAvailable: vi.fn().mockResolvedValue(true), writeSemanticVector: vi.fn(), deleteSemanticVector: vi.fn(),
  findTalentNeighbors: vi.fn().mockResolvedValue([]), findJobNeighbors: vi.fn().mockResolvedValue([]),
}))
vi.mock('@/server/services/semantic-matching', async original => ({
  ...await original<typeof import('@/server/services/semantic-matching')>(), recommendJobs: vi.fn(), recommendTalents: vi.fn(),
}))
vi.mock('@/env', async original => {
  const actual = await original<typeof import('@/env')>()
  return { ...actual, env: { ...actual.env, VOYAGE_API_KEY: 'synthetic-key', AI_MODEL_EMBED: 'synthetic-embedding-model', MARKETING_UNSUBSCRIBE_SECRET: 't'.repeat(48) } }
})

import { setupTestDb, testDb } from '../setup/db'
import { seedT04Gate, t04StudentRecipient, t04EmployerRecipient, t04Job, t04Talent, t04Queued } from '../helpers/weekly-digest-t04'
import { T03_VERSION } from '../helpers/semantic-matching-t03'
import { recommendJobs, recommendTalents, setMatchingConsent } from '@/server/services/semantic-matching'
import { setMarketingConsent } from '@/server/services/marketing-consent'
import { runWeeklyDigest } from '@/server/jobs/weekly-digest'
import { clearSettingsCache } from '@/server/services/settings'
import { addBlockedCompany, setVisibility } from '@/server/services/privacy'
import { checkEmailCap } from '@/server/lib/email-cap'

setupTestDb()
beforeEach(async () => {
  vi.clearAllMocks(); clearSettingsCache(); mail.mockReset().mockResolvedValue(undefined)
  vi.mocked(checkEmailCap).mockReset().mockResolvedValue(true)
  vi.mocked(recommendJobs).mockReset().mockResolvedValue({ availability: 'ready', items: [] })
  vi.mocked(recommendTalents).mockReset().mockResolvedValue({ availability: 'ready', items: [] })
  await seedT04Gate()
})

describe('M9-T04 latest authorization and recipient isolation', () => {
  it('keeps two students and their rows isolated, reads current email, and emits only public job fields', async () => {
    const a = await t04StudentRecipient(), b = await t04StudentRecipient()
    const ja = await t04Job('ONLY_JOB_A'), jb = await t04Job('ONLY_JOB_B')
    const qa = await t04Queued(a.userId), qb = await t04Queued(b.userId)
    await testDb.user.update({ where: { id: a.userId }, data: { email: 'current-a@example.test', locale: 'en' } })
    vi.mocked(recommendJobs).mockImplementation(async ctx => ({ availability: 'ready', items: [ctx.userId === a.userId ? ja.item : jb.item] }))
    await runWeeklyDigest({ deliveryId: qa.id }); await runWeeklyDigest({ deliveryId: qb.id })
    expect(mail).toHaveBeenCalledTimes(2)
    const sentA = mail.mock.calls.find(([message]) => message.to === 'current-a@example.test')?.[0]
    const sentB = mail.mock.calls.find(([message]) => message.to === b.email)?.[0]
    expect(JSON.stringify(sentA)).toContain('ONLY_JOB_A'); expect(JSON.stringify(sentA)).not.toContain('ONLY_JOB_B')
    expect(JSON.stringify(sentB)).toContain('ONLY_JOB_B'); expect(JSON.stringify(sentB)).not.toContain('ONLY_JOB_A')
    expect(sentA.text).toMatch(/unsubscribe/i)
    for (const [message] of mail.mock.calls) {
      expect(Object.keys(message).sort()).toEqual(['html', 'subject', 'text', 'to'])
      expect(JSON.stringify(message)).not.toMatch(/PRIVATE_JOB_BODY|PRIVATE_REQUIREMENTS|765432|sourceHash|embedding|distance/)
    }
    expect(await testDb.jobView.count()).toBe(0)
    expect(await testDb.creditLedger.count()).toBe(0)
    expect(await testDb.application.count()).toBe(0)
  })

  it.each(['missing', 'latest-false-other-version', 'old-grant', 'suspended', 'unverified-email', 'wrong-role', 'matching-revoked'] as const)(
    'blocks queued student mail after %s without recommendation egress', async reason => {
      const student = await t04StudentRecipient(), queued = await t04Queued(student.userId)
      if (reason === 'missing') await testDb.consent.deleteMany({ where: { userId: student.userId, type: 'MARKETING' } })
      if (reason === 'latest-false-other-version') {
        const last = await testDb.consent.findFirstOrThrow({ where: { userId: student.userId, type: 'MARKETING' }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] })
        await testDb.consent.create({ data: { userId: student.userId, type: 'MARKETING', version: 'older-policy', granted: false, createdAt: new Date(last.createdAt.getTime() + 1) } })
      }
      if (reason === 'old-grant') await testDb.consent.updateMany({ where: { userId: student.userId, type: 'MARKETING' }, data: { version: 'old-policy' } })
      if (reason === 'suspended') await testDb.user.update({ where: { id: student.userId }, data: { status: 'SUSPENDED' } })
      if (reason === 'unverified-email') await testDb.user.update({ where: { id: student.userId }, data: { emailVerified: false } })
      if (reason === 'wrong-role') await testDb.user.update({ where: { id: student.userId }, data: { role: 'ADMIN' } })
      if (reason === 'matching-revoked') await setMatchingConsent(student, { granted: false, submittedVersion: T03_VERSION })
      await runWeeklyDigest({ deliveryId: queued.id })
      expect(recommendJobs).not.toHaveBeenCalled(); expect(mail).not.toHaveBeenCalled()
      expect((await testDb.weeklyDigestDelivery.findUniqueOrThrow({ where: { id: queued.id } })).state).toBe('SKIPPED')
    },
  )

  it('uses the employer owned job and narrows even an unlocked talent result to anonymous email fields', async () => {
    const employer = await t04EmployerRecipient(), talent = await t04Talent()
    const queued = await t04Queued(employer.userId)
    vi.mocked(recommendTalents).mockResolvedValue({ availability: 'ready', items: [talent.item] })
    await runWeeklyDigest({ deliveryId: queued.id })
    expect(recommendTalents).toHaveBeenCalledWith({ userId: employer.userId, companyId: employer.companyId }, { jobId: employer.jobId, limit: 5 })
    expect(mail).toHaveBeenCalledOnce()
    expect(mail.mock.calls[0][0].to).toBe(employer.email)
    const encoded = JSON.stringify(mail.mock.calls[0][0])
    expect(encoded).toContain('TypeScript')
    expect(encoded).not.toContain(talent.student.name)
    expect(encoded).not.toContain(talent.student.email)
    expect(encoded).not.toMatch(/resumePreview|sourceHash|leaseToken|distance/)
    expect(await testDb.profileView.count()).toBe(0)
    expect(await testDb.talentUnlock.count()).toBe(0)
  })

  it.each(['hidden', 'blocked', 'matching-revoked'] as const)('reloads talent eligibility after recommendation for %s', async change => {
    const employer = await t04EmployerRecipient(), talent = await t04Talent(), queued = await t04Queued(employer.userId)
    vi.mocked(recommendTalents).mockImplementationOnce(async () => {
      if (change === 'hidden') await setVisibility(talent.student, { granted: false })
      if (change === 'blocked') await addBlockedCompany(talent.student, { companyId: employer.companyId })
      if (change === 'matching-revoked') await setMatchingConsent(talent.student, { granted: false, submittedVersion: T03_VERSION })
      return { availability: 'ready', items: [talent.item] }
    })
    await runWeeklyDigest({ deliveryId: queued.id })
    expect(mail).not.toHaveBeenCalled()
  })

  it.each(['member-removed', 'member-role-changed', 'company-inactive', 'company-unverified', 'source-job-closed'] as const)(
    'rechecks employer authority after recommendation for %s', async change => {
      const employer = await t04EmployerRecipient(), talent = await t04Talent(), queued = await t04Queued(employer.userId)
      vi.mocked(recommendTalents).mockImplementationOnce(async () => {
        if (change === 'member-removed') await testDb.companyMember.deleteMany({ where: { userId: employer.userId } })
        if (change === 'member-role-changed') await testDb.companyMember.updateMany({ where: { userId: employer.userId }, data: { role: 'RECRUITER' } })
        if (change === 'company-inactive') await testDb.company.update({ where: { id: employer.companyId }, data: { isActive: false } })
        if (change === 'company-unverified') await testDb.company.update({ where: { id: employer.companyId }, data: { verificationStatus: 'UNSUBMITTED' } })
        if (change === 'source-job-closed') await testDb.job.update({ where: { id: employer.jobId }, data: { status: 'CLOSED' } })
        return { availability: 'ready', items: [talent.item] }
      })
      await runWeeklyDigest({ deliveryId: queued.id })
      expect(mail).not.toHaveBeenCalled()
    },
  )

  it.each(['closed', 'expired', 'company-inactive'] as const)('reloads job eligibility after recommendation for %s', async change => {
    const student = await t04StudentRecipient(), job = await t04Job('STALE_JOB'), queued = await t04Queued(student.userId)
    vi.mocked(recommendJobs).mockImplementationOnce(async () => {
      if (change === 'closed') await testDb.job.update({ where: { id: job.item.id }, data: { status: 'CLOSED' } })
      if (change === 'expired') await testDb.job.update({ where: { id: job.item.id }, data: { deadline: new Date(Date.now() - 1_000) } })
      if (change === 'company-inactive') await testDb.company.update({ where: { id: job.employer.companyId }, data: { isActive: false } })
      return { availability: 'ready', items: [job.item] }
    })
    await runWeeklyDigest({ deliveryId: queued.id })
    expect(mail).not.toHaveBeenCalled()
  })

  it.each(['revoke', 'regrant', 'disabled'] as const)('rechecks recipient permission after recommendations for %s', async change => {
    const student = await t04StudentRecipient(), job = await t04Job('PERMISSION_RACE'), queued = await t04Queued(student.userId)
    vi.mocked(recommendJobs).mockImplementationOnce(async () => {
      if (change === 'disabled') await testDb.systemSetting.update({ where: { key: 'marketing.weekly' }, data: { value: { enabled: false } } })
      else {
        await setMarketingConsent(student, { granted: false, submittedVersion: T03_VERSION })
        if (change === 'regrant') await setMarketingConsent(student, { granted: true, submittedVersion: T03_VERSION })
      }
      return { availability: 'ready', items: [job.item] }
    })
    await runWeeklyDigest({ deliveryId: queued.id })
    expect(mail).not.toHaveBeenCalled()
  })

  it('honors the noncritical daily cap without a false SENT marker', async () => {
    const student = await t04StudentRecipient(), job = await t04Job('CAPPED_JOB'), queued = await t04Queued(student.userId)
    vi.mocked(recommendJobs).mockResolvedValue({ availability: 'ready', items: [job.item] })
    vi.mocked(checkEmailCap).mockResolvedValue(false)
    await runWeeklyDigest({ deliveryId: queued.id })
    expect(checkEmailCap).toHaveBeenCalledWith({ template: 'weekly-jobs' })
    expect(mail).not.toHaveBeenCalled()
    expect(await testDb.weeklyDigestDelivery.findUniqueOrThrow({ where: { id: queued.id } })).toMatchObject({ state: 'RETRYABLE', sentAt: null })
  })

  it('rechecks consent again after an asynchronous cap lookup', async () => {
    const student = await t04StudentRecipient(), job = await t04Job('FINAL_CHECK'), queued = await t04Queued(student.userId)
    vi.mocked(recommendJobs).mockResolvedValue({ availability: 'ready', items: [job.item] })
    vi.mocked(checkEmailCap).mockImplementationOnce(async () => {
      await setMarketingConsent(student, { granted: false, submittedVersion: T03_VERSION })
      return true
    })
    await runWeeklyDigest({ deliveryId: queued.id })
    expect(mail).not.toHaveBeenCalled()
  })
})
