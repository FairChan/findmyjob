import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/server/db', async () => ({ db: (await import('../setup/db')).testDb }))
vi.mock('@/server/auth', () => ({ getSession: vi.fn(), auth: {} }))

import { setupTestDb, testDb } from '../setup/db'
import { createEmployer, createJob, createStudent } from '../factories'
import { viewTalentProfile } from '@/server/services/talent-view'
import { getApplicantDetail } from '@/server/services/applicants'
import { clearSettingsCache } from '@/server/services/settings'

setupTestDb()
beforeEach(() => { clearSettingsCache() })

const LEGACY = 'legacy-private-parse@example.test'

async function fixture(unlocked: boolean) {
  const student = await createStudent(testDb)
  const employer = await createEmployer(testDb)
  await testDb.company.update({
    where: { id: employer.companyId }, data: { verificationStatus: 'VERIFIED' },
  })
  await testDb.studentProfile.update({
    where: { id: student.profileId },
    data: { visibility: 'PUBLIC', completeness: 80, schoolVerifiedAt: new Date(), summary: 'Approved profile summary' },
  })
  const resume = await testDb.resumeFile.create({
    data: {
      studentId: student.profileId, storageKey: `resumes/${student.userId}/private.pdf`,
      fileName: 'synthetic.pdf', mimeType: 'application/pdf', sizeBytes: 100, isPrimary: true,
      parsedJson: { summary: LEGACY, nested: { email: LEGACY } },
    },
  })
  const job = await createJob(testDb, employer.companyId, employer.userId)
  const application = await testDb.application.create({
    data: { jobId: job.id, studentId: student.profileId, resumeId: resume.id },
  })
  if (unlocked) {
    await testDb.talentUnlock.create({
      data: {
        companyId: employer.companyId, studentId: student.profileId,
        unlockedById: employer.userId, source: 'APPLICATION',
      },
    })
  }
  return { student, employer, resume, application }
}

describe('M9-T01 existing employer services reject legacy parse disclosure', () => {
  it.each([
    { surface: 'talent', unlocked: false },
    { surface: 'talent', unlocked: true },
    { surface: 'applicant', unlocked: false },
    { surface: 'applicant', unlocked: true },
  ])('$surface / unlocked=$unlocked returns no legacy parsing content', async ({ surface, unlocked }) => {
    const f = await fixture(unlocked)
    const ctx = { userId: f.employer.userId, companyId: f.employer.companyId, role: 'OWNER' as const }
    const result = surface === 'talent'
      ? await viewTalentProfile(ctx, f.student.profileId)
      : (await getApplicantDetail(ctx, f.application.id)).profile
    expect(result.unlocked).toBe(unlocked)
    expect(result.resumePreview).toBeNull()
    expect(result.summary).toBe('Approved profile summary')
    expect(result.resumeIds).toEqual(unlocked ? [f.resume.id] : [])
    const json = JSON.stringify(result)
    expect(json).not.toContain(LEGACY)
    expect(json).not.toContain(f.resume.storageKey)
    expect(json).not.toContain('parsedJson')
    // The fix is an output boundary; it must not mutate legacy source records.
    expect((await testDb.resumeFile.findUniqueOrThrow({ where: { id: f.resume.id } })).parsedJson)
      .toEqual({ summary: LEGACY, nested: { email: LEGACY } })
  })
})
