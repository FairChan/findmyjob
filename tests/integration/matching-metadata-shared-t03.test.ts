import { describe, expect, it } from 'vitest'
import { setupTestDb, testDb } from '../setup/db'
import { createStudent, createEmployer, createJob } from '../factories'
import { readDataExportSnapshot } from '@/server/services/data-export-snapshot'
import { LOCK_NS, lockXact } from '@/server/lib/advisory-locks'
setupTestDb()
const common = { sourceHash: 'a'.repeat(64), sourceRevision: 0, configurationId: 'matching-public-v1', model: 'synthetic-model', gateEpoch: '00000000-0000-4000-8000-000000000000', legalVersion: 'synthetic-policy' }
describe('ordinary PostgreSQL matching metadata constraints without vector', () => {
  it('allows one row per source and cascades physical source removal', async () => {
    const student = await createStudent(testDb), employer = await createEmployer(testDb)
    const job = await createJob(testDb, employer.companyId, employer.userId)
    const grant = await testDb.consent.create({ data: { userId: student.userId, type: 'AI_MATCHING', granted: true, version: 'synthetic-policy' } })
    const studentIndex = await testDb.semanticIndex.create({ data: { ...common, kind: 'STUDENT', studentId: student.profileId, consentGrantId: grant.id, state: 'PROCESSING', leaseToken: 'synthetic-private-lease', leaseExpiresAt: new Date(Date.now() + 60000) } })
    const jobIndex = await testDb.semanticIndex.create({ data: { ...common, kind: 'JOB', jobId: job.id } })
    expect(job.matchingRevision).toBe(0)
    const exported = await testDb.$transaction(async tx => {
      await lockXact(tx, LOCK_NS.STUDENT_DATA, student.userId)
      await lockXact(tx, LOCK_NS.DATA_EXPORT, student.userId)
      return readDataExportSnapshot(tx, student.userId)
    })
    expect(Object.keys(exported!.files['matching.json'] as object).sort()).toEqual(['completedAt', 'generation', 'kind', 'requestedAt', 'sourceRevision', 'state', 'updatedAt'])
    expect(JSON.stringify(exported)).not.toContain(common.sourceHash)
    expect(JSON.stringify(exported)).not.toContain(common.model)
    expect(JSON.stringify(exported)).not.toContain(common.gateEpoch)
    expect(JSON.stringify(exported)).not.toContain('synthetic-private-lease')
    await expect(testDb.semanticIndex.create({ data: { ...common, kind: 'JOB', jobId: job.id } })).rejects.toThrow()
    await testDb.studentProfile.delete({ where: { id: student.profileId } })
    await testDb.job.delete({ where: { id: job.id } })
    expect(await testDb.semanticIndex.count({ where: { id: { in: [studentIndex.id, jobIndex.id] } } })).toBe(0)
  })
  it('rejects missing/ambiguous owners and kind/grant mismatch in the DB', async () => {
    const student = await createStudent(testDb), employer = await createEmployer(testDb)
    const job = await createJob(testDb, employer.companyId, employer.userId)
    for (const data of [
      { ...common, kind: 'JOB' as const },
      { ...common, kind: 'JOB' as const, studentId: student.profileId },
      { ...common, kind: 'JOB' as const, jobId: job.id, studentId: student.profileId },
      { ...common, kind: 'JOB' as const, jobId: job.id, consentGrantId: 'not-a-job-grant' },
      { ...common, kind: 'STUDENT' as const, studentId: student.profileId },
    ]) await expect(testDb.semanticIndex.create({ data })).rejects.toThrow()
  })
  it('rejects invalid revisions, attempts, source hash and incomplete leases in the DB', async () => {
    const employer = await createEmployer(testDb)
    const job = await createJob(testDb, employer.companyId, employer.userId)
    for (const invalid of [{ generation: 0 }, { sourceRevision: -1 }, { attempts: 4 }, { sourceHash: 'invalid' }, { failureCode: 'RAW_PROVIDER_TEXT' }, { leaseToken: 'lease-without-expiry' }]) {
      await expect(testDb.semanticIndex.create({ data: { ...common, kind: 'JOB', jobId: job.id, ...invalid } })).rejects.toThrow()
    }
    await expect(testDb.job.update({ where: { id: job.id }, data: { matchingRevision: -1 } })).rejects.toThrow()
  })
})
