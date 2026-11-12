import { randomUUID } from 'node:crypto'
import { testDb } from '../setup/db'
import { createEmployer, createJob, createStudent } from '../factories'
import { setMatchingConsent, requestStudentMatchingIndex, requestJobMatchingIndex } from '@/server/services/semantic-matching'

export const T03_VERSION = 'synthetic-matching-policy'
export const T03_CONFIG = 'matching-public-v1'
export const T03_MODEL = 'synthetic-embedding-model'
export const T03_VECTOR = [1, ...Array<number>(1023).fill(0)]

export async function seedT03Gate() {
  const gate = { enabled: true, legalVersion: T03_VERSION, epoch: randomUUID(), configurationId: T03_CONFIG }
  for (const [key, value] of [['legal.currentVersion', T03_VERSION], ['ai.matching', gate]] as const) {
    await testDb.systemSetting.upsert({ where: { key }, create: { key, value }, update: { value } })
  }
  return gate
}

async function legal(userId: string) {
  await testDb.consent.createMany({ data: ['TERMS', 'PRIVACY'].map(type => ({
    userId, type: type as 'TERMS' | 'PRIVACY', version: T03_VERSION, granted: true,
  })) })
}

export async function t03Student() {
  const student = await createStudent(testDb, { name: 'PRIVATE Fullname Sentinel', completeness: 70 })
  await testDb.studentProfile.update({ where: { id: student.profileId }, data: {
    visibility: 'PUBLIC', schoolVerifiedAt: new Date(), headline: 'TypeScript developer', major: 'Computing', skills: ['TypeScript'],
  } })
  await legal(student.userId)
  await setMatchingConsent({ userId: student.userId }, { granted: true, submittedVersion: T03_VERSION })
  return student
}

export async function t03Employer() {
  const employer = await createEmployer(testDb)
  await testDb.company.update({ where: { id: employer.companyId }, data: { verificationStatus: 'VERIFIED' } })
  await legal(employer.userId)
  const job = await createJob(testDb, employer.companyId, employer.userId)
  await testDb.job.update({ where: { id: job.id }, data: { title: 'TypeScript developer', skills: ['TypeScript'], publishedAt: new Date() } })
  return { ...employer, jobId: job.id }
}

export async function readyT03Student(student: Awaited<ReturnType<typeof t03Student>>) {
  const request = await requestStudentMatchingIndex({ userId: student.userId })
  return testDb.semanticIndex.update({ where: { id: request.indexId }, data: {
    state: 'READY', completedAt: new Date(), leaseToken: null, leaseExpiresAt: null,
  } })
}

export async function readyT03Job(employer: Awaited<ReturnType<typeof t03Employer>>) {
  const request = await requestJobMatchingIndex(employer, { jobId: employer.jobId })
  return testDb.semanticIndex.update({ where: { id: request.indexId }, data: {
    state: 'READY', completedAt: new Date(), leaseToken: null, leaseExpiresAt: null,
  } })
}

export function t03Neighbor(index: { id: string; generation: number; sourceHash: string }, subjectId: string, distance = 0.1) {
  return { indexId: index.id, subjectId, generation: index.generation, sourceHash: index.sourceHash, distance }
}

export function t03Deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}

export async function t03Bounded<T>(promise: Promise<T>): Promise<T> {
  let timer!: ReturnType<typeof setTimeout>
  try {
    return await Promise.race([promise, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('Synthetic boundary was not reached')), 5_000)
    })])
  } finally { clearTimeout(timer) }
}
