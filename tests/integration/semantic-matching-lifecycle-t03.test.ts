import { createHash, randomUUID } from 'node:crypto'
import type { Job } from '@prisma/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'
const io = vi.hoisted(() => ({ remove: vi.fn(), s3: vi.fn() }))
vi.mock('@/server/db', async () => ({ db: (await import('../setup/db')).testDb }))
vi.mock('@/server/jobs/boss', () => ({ sendBoss: { start: vi.fn(), send: vi.fn().mockResolvedValue('synthetic-job') } }))
vi.mock('@/server/lib/ai/embedding-provider', () => ({ embedMatchingText: vi.fn() }))
vi.mock('@/server/lib/semantic-store', () => ({
  isSemanticStoreAvailable: vi.fn().mockResolvedValue(true), findTalentNeighbors: vi.fn(), findJobNeighbors: vi.fn(),
  writeSemanticVector: vi.fn(), deleteSemanticVector: vi.fn(),
}))
vi.mock('@/lib/storage', () => ({ deleteAllVersions: io.remove, getObjectBytes: vi.fn(), putObject: vi.fn() }))
vi.mock('@/server/services/notify', () => ({ sendNotificationEmail: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/server/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }))
vi.mock('@/server/action', () => ({ action: (_options: unknown, handler: unknown) => handler }))
vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: class { send = io.s3 },
  ListObjectVersionsCommand: class { constructor(public input: unknown) {} },
  DeleteObjectsCommand: class { constructor(public input: unknown) {} },
}))
vi.mock('@/env', async original => {
  const actual = await original<typeof import('@/env')>()
  return { ...actual, env: { ...actual.env, VOYAGE_API_KEY: 'synthetic-key', AI_MODEL_EMBED: 'synthetic-embedding-model',
    ANTHROPIC_API_KEY: 'synthetic-key', AI_MODEL_PARSE: 'synthetic-model' } }
})

import { setupTestDb, testDb } from '../setup/db'
import { createAdmin } from '../factories'
import { seedT03Gate, t03Student, t03Employer as seedT03Employer, readyT03Student, readyT03Job, t03Deferred, t03Bounded, T03_VERSION, T03_VECTOR, T03_MODEL } from '../helpers/semantic-matching-t03'
import { readyT01Resume, seedT01Resume } from '../helpers/resume-parsing-t01'
import { clearSettingsCache } from '@/server/services/settings'
import { saveStep1, saveStep2, saveStep3, saveStep4, recalcOwnCompleteness } from '@/server/services/student-profile'
import { confirmResumeParse, setResumeParseConsent } from '@/server/services/resume-parsing'
import { setVisibility, addBlockedCompany, removeBlockedCompany } from '@/server/services/privacy'
import { approveSchoolVerificationManually, suspendUser, restoreUser } from '@/server/services/admin-users'
import { verifySchoolOtp } from '@/server/services/school-verification'
import { updateOwnContact } from '@/server/services/contact-access'
import { requestDeletion } from '@/server/services/data-rights'
import { deleteResume } from '@/server/actions/resume'
import { runPurgeDeletedAccounts } from '@/server/jobs/purge-deleted-accounts'
import { setMatchingConsent, requestStudentMatchingIndex, requestJobMatchingIndex } from '@/server/services/semantic-matching'
import { runMatchingIndex } from '@/server/jobs/index-matching'
import { embedMatchingText } from '@/server/lib/ai/embedding-provider'
import { deleteSemanticVector, writeSemanticVector } from '@/server/lib/semantic-store'
import { jobFormSchema, updateJob, closeJob, copyJob, type JobFormInput } from '@/server/services/jobs'
import { approveJob, rejectJob } from '@/server/services/review-jobs'
import { deactivateCompany, reactivateCompany } from '@/server/services/admin-companies'
import { approveCompany, rejectCompany } from '@/server/services/review-company'
import { openJob } from '@/server/services/job-view-quota'

setupTestDb()
beforeEach(async () => {
  vi.clearAllMocks(); clearSettingsCache()
  io.remove.mockReset().mockResolvedValue(undefined)
  io.s3.mockReset().mockResolvedValue({ Versions: [], DeleteMarkers: [], IsTruncated: false })
  vi.mocked(embedMatchingText).mockReset().mockResolvedValue({ ok: true, vector: T03_VECTOR, model: T03_MODEL })
  await seedT03Gate()
})

const profileRow = (id: string) => testDb.studentProfile.findUniqueOrThrow({ where: { id } })
const t03Employer = async () => ({ ...await seedT03Employer(), role: 'OWNER' as const })
const jobRow = (id: string) => testDb.job.findUniqueOrThrow({ where: { id } })
const indexRow = (id: string) => testDb.semanticIndex.findUniqueOrThrow({ where: { id } })
async function expectCancelled(index: { id: string; generation: number }, increments = 1) {
  expect(await indexRow(index.id)).toMatchObject({ state: 'CANCELLED', generation: index.generation + increments,
    leaseToken: null, leaseExpiresAt: null, nextAttemptAt: null })
}
function jobInput(job: Job, patch: Partial<JobFormInput> = {}): JobFormInput {
  return jobFormSchema.parse({
    title: job.title, type: job.type, category: job.category ?? undefined, description: job.description,
    requirements: job.requirements ?? undefined, benefits: job.benefits ?? undefined, workMode: job.workMode,
    state: job.state ?? undefined, city: job.city ?? undefined, salaryMin: job.salaryMin ?? undefined,
    salaryMax: job.salaryMax ?? undefined, salaryVisible: job.salaryVisible, languages: job.languages,
    skills: job.skills, acceptsStudentPass: job.acceptsStudentPass, sponsorsWorkPass: job.sponsorsWorkPass,
    headcount: job.headcount ?? undefined, deadline: job.deadline?.toISOString(), updatedAt: job.updatedAt.toISOString(), ...patch,
  })
}
async function autoPublish(companyId: string) {
  await testDb.company.update({ where: { id: companyId }, data: { approvedJobCount: 1000 } })
}

describe('M9-T03 existing student lifecycle writers', () => {
  it.each([1, 2, 3, 4])('step%s cancels metadata and advances the existing T01 revision exactly once', async step => {
    const student = await t03Student(), index = await readyT03Student(student), before = await profileRow(student.profileId)
    const ctx = { userId: student.userId }
    if (step === 1) await saveStep1(ctx, { fullName: 'Synthetic name', workAuth: 'STUDENT_PASS' })
    if (step === 2) await saveStep2(ctx, { intents: ['FULL_TIME'], preferredStates: ['KUL'] })
    if (step === 3) await saveStep3(ctx, { languages: [], skills: ['Rust'], headline: 'Changed career' })
    if (step === 4) await saveStep4(ctx, { educations: [], experiences: [{ kind: 'PROJECT', title: 'Synthetic project' }] })
    expect((await profileRow(student.profileId)).editRevision).toBe(before.editRevision + 1)
    await expectCancelled(index)
  })

  it('confirmation invalidates once; confirmed replay preserves generation and revision', async () => {
    const student = await t03Student(), index = await readyT03Student(student)
    await testDb.systemSetting.create({ data: { key: 'ai.resumeParse', value: { enabled: true, legalVersion: T03_VERSION, epoch: randomUUID() } } })
    await setResumeParseConsent({ userId: student.userId }, { granted: true, submittedVersion: T03_VERSION })
    const ready = await readyT01Resume(student), before = await profileRow(student.profileId)
    const input = { resumeId: ready.resume.id, generation: ready.draft.generation, expectedProfileRevision: before.editRevision,
      patch: { headline: 'Confirmed career' } }
    expect(await confirmResumeParse({ userId: student.userId }, input)).toMatchObject({ alreadyApplied: false, appliedProfileRevision: before.editRevision + 1 })
    await expectCancelled(index)
    expect(await confirmResumeParse({ userId: student.userId }, input)).toMatchObject({ alreadyApplied: true })
    await expectCancelled(index)
    expect((await profileRow(student.profileId)).editRevision).toBe(before.editRevision + 1)
  })

  it('hide then show cannot revive the old generation even with unchanged projection', async () => {
    const student = await t03Student(), index = await readyT03Student(student), before = await profileRow(student.profileId)
    await setVisibility(student, { granted: false })
    await setVisibility(student, { granted: true })
    await expectCancelled(index, 2)
    expect((await profileRow(student.profileId)).editRevision).toBe(before.editRevision + 2)
  })

  it('suspend then restore invalidates both transitions without reviving a deleted account', async () => {
    const admin = await createAdmin(testDb), student = await t03Student(), index = await readyT03Student(student)
    const before = await profileRow(student.profileId)
    await suspendUser(admin, { targetUserId: student.userId, reason: 'Synthetic moderation' })
    await restoreUser(admin, { targetUserId: student.userId })
    await expectCancelled(index, 2)
    expect((await profileRow(student.profileId)).editRevision).toBe(before.editRevision + 2)
    await requestDeletion(student)
    await restoreUser(admin, { targetUserId: student.userId })
    expect((await testDb.user.findUniqueOrThrow({ where: { id: student.userId } })).status).toBe('DELETED')
  })

  it.each(['manual', 'otp'] as const)('%s school verification invalidates eligibility metadata', async method => {
    const student = await t03Student(), index = await readyT03Student(student), admin = await createAdmin(testDb)
    await testDb.studentProfile.update({ where: { id: student.profileId }, data: { schoolVerifiedAt: null } })
    const before = await profileRow(student.profileId)
    if (method === 'manual') await approveSchoolVerificationManually(admin, student.userId)
    else {
      const school = await testDb.school.create({ data: { nameZh: '合成学校', nameEn: 'Synthetic school', emailDomains: ['example.test'] } })
      const otp = '123456'
      await testDb.verification.create({ data: { identifier: `school-otp:${student.userId}`,
        value: JSON.stringify({ hash: createHash('sha256').update(otp).digest('hex'), schoolId: school.id, schoolEmail: `${student.userId}@example.test` }),
        expiresAt: new Date(Date.now() + 60_000) } })
      await verifySchoolOtp(student, { otp })
    }
    await expectCancelled(index)
    expect((await profileRow(student.profileId)).editRevision).toBe(before.editRevision + 1)
  })

  it('contact completeness changes invalidate atomically; replacing one contact value does not', async () => {
    const student = await t03Student(), index = await readyT03Student(student)
    await testDb.studentProfile.update({ where: { id: student.profileId }, data: { completeness: 20 } })
    const before = await profileRow(student.profileId)
    await updateOwnContact(student, { email: 'first@example.test' })
    expect(await profileRow(student.profileId)).toMatchObject({ completeness: 25, editRevision: before.editRevision + 1 })
    await expectCancelled(index)
    await updateOwnContact(student, { email: 'second@example.test' })
    await recalcOwnCompleteness(student)
    await expectCancelled(index)
    expect((await profileRow(student.profileId)).editRevision).toBe(before.editRevision + 1)
  })

  it('deleting the last resume invalidates completeness before a failed storage cleanup', async () => {
    const student = await t03Student(), index = await readyT03Student(student), resume = await seedT01Resume(student)
    await testDb.studentProfile.update({ where: { id: student.profileId }, data: { completeness: 30 } })
    const before = await profileRow(student.profileId)
    io.remove.mockRejectedValueOnce(new Error('Synthetic storage failure'))
    const call = deleteResume as unknown as (ctx: { userId: string; input: { resumeId: string } }) => Promise<unknown>
    await expect(call({ userId: student.userId, input: { resumeId: resume.id } })).rejects.toThrow('Synthetic storage failure')
    expect(await testDb.resumeFile.findUnique({ where: { id: resume.id } })).toBeNull()
    expect(await profileRow(student.profileId)).toMatchObject({ completeness: 20, editRevision: before.editRevision + 1 })
    await expectCancelled(index)
  })

  it('soft deletion cancels the index; repeated deletion does not bump profile revision again', async () => {
    const student = await t03Student(), index = await readyT03Student(student), before = await profileRow(student.profileId)
    await requestDeletion(student)
    await expectCancelled(index)
    await requestDeletion(student)
    expect(await profileRow(student.profileId)).toMatchObject({ visibility: 'HIDDEN', editRevision: before.editRevision + 1 })
    expect((await indexRow(index.id)).state).toBe('CANCELLED')
  })

  it('purge invalidates before storage and advances source revision on anonymization', async () => {
    const student = await t03Student(), index = await readyT03Student(student), before = await profileRow(student.profileId)
    await testDb.user.update({ where: { id: student.userId }, data: { status: 'DELETED', deletedAt: new Date(Date.now() - 31 * 86_400_000) } })
    io.s3.mockImplementationOnce(async () => {
      expect((await indexRow(index.id)).state).toBe('CANCELLED')
      return { Versions: [], DeleteMarkers: [], IsTruncated: false }
    })
    expect(await runPurgeDeletedAccounts()).toEqual({ purged: 1 })
    expect((await profileRow(student.profileId)).editRevision).toBe(before.editRevision + 1)
    expect((await indexRow(index.id)).generation).toBeGreaterThan(index.generation)
  })

  it('uses the existing consent withdrawal cancellation once, without a second wrapper hook', async () => {
    const student = await t03Student(), index = await readyT03Student(student), before = await profileRow(student.profileId)
    const withdrawalStartedAt = Date.now()
    await setMatchingConsent(student, { granted: false })
    const withdrawalFinishedAt = Date.now()
    const cancelled = await indexRow(index.id)
    expect(cancelled).toMatchObject({ state: 'CANCELLED', generation: index.generation + 1,
      leaseToken: null, leaseExpiresAt: null })
    expect(deleteSemanticVector).toHaveBeenCalledExactlyOnceWith(expect.anything(), index.id)
    expect(cancelled.nextAttemptAt).toBeInstanceOf(Date)
    expect(cancelled.nextAttemptAt?.getTime()).toBeGreaterThanOrEqual(withdrawalStartedAt + 24 * 60 * 60 * 1000)
    expect(cancelled.nextAttemptAt?.getTime()).toBeLessThanOrEqual(withdrawalFinishedAt + 24 * 60 * 60 * 1000)
    expect((await profileRow(student.profileId)).editRevision).toBe(before.editRevision)
  })

  it('company-specific block/unblock does not globally cancel student metadata', async () => {
    const student = await t03Student(), employer = await t03Employer(), index = await readyT03Student(student)
    await addBlockedCompany(student, { companyId: employer.companyId })
    await removeBlockedCompany(student, { companyId: employer.companyId })
    expect(await indexRow(index.id)).toEqual(index)
  })

  it('a real save ABA during worker I/O prevents late publication', async () => {
    const student = await t03Student(), request = await requestStudentMatchingIndex(student)
    const before = await profileRow(student.profileId), entered = t03Deferred<void>(), release = t03Deferred<void>()
    vi.mocked(embedMatchingText).mockImplementationOnce(async () => {
      entered.resolve(); await release.promise; return { ok: true, vector: T03_VECTOR, model: T03_MODEL }
    })
    const work = runMatchingIndex(request).then(() => null, error => error)
    try {
      await t03Bounded(entered.promise)
      await saveStep3(student, { languages: [], skills: ['Rust'], headline: 'Temporary career' })
      await saveStep3(student, { languages: [], skills: before.skills, headline: before.headline, summary: before.summary })
    } finally { release.resolve() }
    expect(await t03Bounded(work)).toBeNull()
    expect(writeSemanticVector).not.toHaveBeenCalled()
    expect((await indexRow(request.indexId)).state).toBe('CANCELLED')
  })
})

describe('M9-T03 existing job lifecycle writers', () => {
  it.each(['career', 'deadline', 'review-state'] as const)('%s changes advance matchingRevision exactly once', async change => {
    const employer = await t03Employer(), index = await readyT03Job(employer), before = await jobRow(employer.jobId)
    if (change !== 'review-state') await autoPublish(employer.companyId)
    const patch = change === 'career' ? { title: 'Rust developer' } : change === 'deadline'
      ? { deadline: new Date(Date.now() + 86_400_000).toISOString() } : { description: 'Changed private description' }
    await updateJob(employer, employer.jobId, jobInput(before, patch))
    expect((await jobRow(employer.jobId)).matchingRevision).toBe(before.matchingRevision + 1)
    await expectCancelled(index)
  })

  it('body/salary-only edits preserve matching revision when publication state remains unchanged', async () => {
    const employer = await t03Employer(), index = await readyT03Job(employer), before = await jobRow(employer.jobId)
    await autoPublish(employer.companyId)
    await updateJob(employer, employer.jobId, jobInput(before, { description: 'Changed private body', salaryMin: 2345, salaryMax: 3456 }))
    expect((await jobRow(employer.jobId)).matchingRevision).toBe(before.matchingRevision)
    expect(await indexRow(index.id)).toEqual(index)
  })

  it('ordinary career saves remain available with matching disabled and a non-indexable title', async () => {
    const employer = await t03Employer(), index = await readyT03Job(employer), before = await jobRow(employer.jobId)
    await autoPublish(employer.companyId)
    await testDb.systemSetting.update({ where: { key: 'ai.matching' }, data: { value: { enabled: false } } })
    await updateJob(employer, employer.jobId, jobInput(before, { title: 'synthetic-contact@example.test' }))
    expect(await jobRow(employer.jobId)).toMatchObject({ title: 'synthetic-contact@example.test', matchingRevision: before.matchingRevision + 1 })
    await expectCancelled(index)
  })

  it('normal job views and analytics counters preserve revision and READY metadata', async () => {
    const employer = await t03Employer(), student = await t03Student(), index = await readyT03Job(employer), before = await jobRow(employer.jobId)
    expect((await openJob(student.profileId, employer.jobId)).allowed).toBe(true)
    await testDb.job.update({ where: { id: employer.jobId }, data: { viewCount: { increment: 1 } } })
    await testDb.studentProfile.update({ where: { id: student.profileId }, data: { lastActiveAt: new Date() } })
    expect((await jobRow(employer.jobId)).matchingRevision).toBe(before.matchingRevision)
    expect(await indexRow(index.id)).toEqual(index)
  })

  it('close invalidates once and a repeated close does not create another revision', async () => {
    const employer = await t03Employer(), index = await readyT03Job(employer), before = await jobRow(employer.jobId)
    await closeJob(employer, employer.jobId); await closeJob(employer, employer.jobId)
    expect((await jobRow(employer.jobId)).matchingRevision).toBe(before.matchingRevision + 1)
    await expectCancelled(index)
  })

  it.each(['approve', 'reject'] as const)('%s invalidates a reviewed job in the same successful CAS', async decision => {
    const employer = await t03Employer(), index = await readyT03Job(employer), admin = await createAdmin(testDb)
    const before = await testDb.job.update({ where: { id: employer.jobId }, data: { status: 'PENDING_REVIEW' } })
    if (decision === 'approve') await approveJob(admin, { jobId: before.id, updatedAt: before.updatedAt })
    else await rejectJob(admin, { jobId: before.id, updatedAt: before.updatedAt, reviewNote: 'Synthetic review' })
    expect((await jobRow(employer.jobId)).matchingRevision).toBe(before.matchingRevision + 1)
    await expectCancelled(index)
  })

  it('failed stale edit preserves the existing revision and metadata', async () => {
    const employer = await t03Employer(), index = await readyT03Job(employer), before = await jobRow(employer.jobId)
    await expect(updateJob(employer, employer.jobId, jobInput(before, { title: 'Uncommitted', updatedAt: new Date(0).toISOString() }))).rejects.toMatchObject({ code: 'VALIDATION_ERROR' })
    expect((await jobRow(employer.jobId)).matchingRevision).toBe(before.matchingRevision)
    expect(await indexRow(index.id)).toEqual(index)
  })

  it('copy starts with revision zero and does not copy semantic metadata', async () => {
    const employer = await t03Employer(); await readyT03Job(employer)
    await testDb.job.update({ where: { id: employer.jobId }, data: { matchingRevision: 9 } })
    const copy = await copyJob(employer, employer.jobId)
    expect(copy).toMatchObject({ status: 'DRAFT', matchingRevision: 0, viewCount: 0 })
    expect(await testDb.semanticIndex.findUnique({ where: { jobId: copy.id } })).toBeNull()
  })

  it('company deactivate/reactivate invalidates every existing job without a vector ABA', async () => {
    const employer = await t03Employer(), index = await readyT03Job(employer), admin = await createAdmin(testDb), before = await jobRow(employer.jobId)
    await deactivateCompany(admin, { companyId: employer.companyId, reason: 'Synthetic moderation' })
    await reactivateCompany(admin, { companyId: employer.companyId })
    await expectCancelled(index, 2)
    expect((await jobRow(employer.jobId)).matchingRevision).toBe(before.matchingRevision + 2)
  })

  it.each(['approve', 'reject'] as const)('company %s invalidates dependent jobs on a verification transition', async decision => {
    const employer = await t03Employer(), index = await readyT03Job(employer), admin = await createAdmin(testDb), before = await jobRow(employer.jobId)
    await testDb.company.update({ where: { id: employer.companyId }, data: { verificationStatus: 'PENDING' } })
    const verification = await testDb.companyVerification.create({ data: { companyId: employer.companyId, submittedById: employer.userId, documentKeys: [], status: 'PENDING' } })
    if (decision === 'approve') await approveCompany(admin, { verificationId: verification.id, verifiedChannels: ['WEBSITE'], verificationResult: 'Synthetic check' })
    else await rejectCompany(admin, { verificationId: verification.id, reviewNote: 'Synthetic check' })
    await expectCancelled(index)
    expect((await jobRow(employer.jobId)).matchingRevision).toBe(before.matchingRevision + 1)
  })

  it('a real job edit ABA during worker I/O rejects late document publication', async () => {
    const employer = await t03Employer(), request = await requestJobMatchingIndex(employer, { jobId: employer.jobId })
    await autoPublish(employer.companyId)
    const before = await jobRow(employer.jobId), entered = t03Deferred<void>(), release = t03Deferred<void>()
    vi.mocked(embedMatchingText).mockImplementationOnce(async () => {
      entered.resolve(); await release.promise; return { ok: true, vector: T03_VECTOR, model: T03_MODEL }
    })
    const work = runMatchingIndex(request).then(() => null, error => error)
    try {
      await t03Bounded(entered.promise)
      await updateJob(employer, employer.jobId, jobInput(before, { title: 'Temporary career' }))
      await updateJob(employer, employer.jobId, jobInput(await jobRow(employer.jobId), { title: before.title }))
    } finally { release.resolve() }
    expect(await t03Bounded(work)).toBeNull()
    expect(writeSemanticVector).not.toHaveBeenCalled()
    expect((await indexRow(request.indexId)).state).toBe('CANCELLED')
  })
})
