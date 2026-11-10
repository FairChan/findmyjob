import { createHash, randomUUID } from 'node:crypto'
import { testDb } from '../setup/db'
import { createStudent } from '../factories'
import type { StudentResult } from '../factories'
import { requestResumeParse, setResumeParseConsent } from '@/server/services/resume-parsing'

export const T01_VERSION = 'm9-synthetic-policy'
export const T01_BYTES = Buffer.from('%PDF-1.4 synthetic bounded fixture')
export const T01_HASH = createHash('sha256').update(T01_BYTES).digest('hex')
export const T01_SUGGESTION = {
  headline: 'Draft headline', summary: 'Draft summary', skills: ['TypeScript'],
  languages: [{ language: 'English', level: 'FLUENT' as const }],
  educations: [{
    schoolName: 'Synthetic University', degreeLevel: 'BACHELOR' as const, major: 'Computing',
    startDate: null, endDate: null, gpa: null, description: 'Synthetic education',
  }],
  experiences: [{
    kind: 'PROJECT' as const, title: 'Synthetic project', organization: null,
    startDate: null, endDate: null, description: 'Synthetic experience',
  }],
}

export async function seedT01Gate() {
  const gate = { enabled: true, legalVersion: T01_VERSION, epoch: randomUUID() }
  for (const [key, value] of [['legal.currentVersion', T01_VERSION], ['ai.resumeParse', gate]] as const) {
    await testDb.systemSetting.upsert({ where: { key }, create: { key, value }, update: { value } })
  }
  return gate
}

export async function seedT01Student() {
  const student = await createStudent(testDb)
  await testDb.studentProfile.update({
    where: { id: student.profileId },
    data: { headline: 'Existing headline', summary: 'Existing summary', skills: ['Existing skill'], workAuth: 'STUDENT_PASS' },
  })
  await testDb.consent.createMany({
    data: ['TERMS', 'PRIVACY'].map(type => ({
      userId: student.userId, type: type as 'TERMS' | 'PRIVACY', version: T01_VERSION, granted: true,
    })),
  })
  await setResumeParseConsent({ userId: student.userId }, { granted: true, submittedVersion: T01_VERSION })
  return student
}

export async function seedT01Resume(student: StudentResult) {
  return testDb.resumeFile.create({
    data: {
      studentId: student.profileId, storageKey: `resumes/${student.profileId}/${randomUUID()}.pdf`,
      fileName: 'synthetic.pdf', mimeType: 'application/pdf', sizeBytes: T01_BYTES.length,
      pageCount: 1, contentSha256: T01_HASH, parsedJson: { legacy: 'untouched-legacy' },
    },
  })
}

export async function readyT01Resume(student: StudentResult) {
  const resume = await seedT01Resume(student)
  const requested = await requestResumeParse({ userId: student.userId }, { resumeId: resume.id })
  const draft = await testDb.resumeParseDraft.update({
    where: { resumeId: resume.id },
    data: {
      state: 'READY', payload: T01_SUGGESTION, completedAt: new Date(),
      responseModel: 'synthetic-response-model', leaseToken: null, leaseExpiresAt: null,
    },
  })
  return { resume, requested, draft }
}

export async function readyT01Fixture() {
  await seedT01Gate()
  const student = await seedT01Student()
  const ready = await readyT01Resume(student)
  const profile = await testDb.studentProfile.findUniqueOrThrow({ where: { id: student.profileId } })
  return {
    student, ...ready, profile, ctx: { userId: student.userId },
    confirmation: {
      resumeId: ready.resume.id, generation: ready.draft.generation,
      expectedProfileRevision: profile.editRevision,
    },
  }
}

export async function snapshotT01Profile(profileId: string) {
  return testDb.studentProfile.findUniqueOrThrow({
    where: { id: profileId },
    include: { languages: { orderBy: { language: 'asc' } }, educations: { orderBy: { id: 'asc' } }, experiences: { orderBy: { id: 'asc' } } },
  })
}
