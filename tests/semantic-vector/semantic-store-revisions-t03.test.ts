import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
vi.mock('@/server/db', async () => ({ db: (await import('../setup/db')).testDb }))
vi.mock('@/server/jobs/boss', () => ({ sendBoss: { start: vi.fn().mockResolvedValue(undefined), send: vi.fn().mockResolvedValue('synthetic-job') } }))
vi.mock('@/server/lib/ai/embedding-provider', () => ({ embedMatchingText: vi.fn(() => { throw new Error('No provider in vector tests') }) }))
vi.mock('@/env', async importOriginal => {
  const actual = await importOriginal<typeof import('@/env')>()
  return { ...actual, env: { ...actual.env, VOYAGE_API_KEY: 'synthetic-key', AI_MODEL_EMBED: 'synthetic-embedding-model' } }
})
import { setupTestDb, testDb } from '../setup/db'
import { findJobNeighbors, findTalentNeighbors, isSemanticStoreAvailable, writeSemanticVector } from '@/server/lib/semantic-store'
import { clearSettingsCache } from '@/server/services/settings'
import { seedT03Gate, t03Student, t03Employer, readyT03Student, readyT03Job, T03_VECTOR, T03_CONFIG } from '../helpers/semantic-matching-t03'

setupTestDb()
beforeEach(() => { clearSettingsCache() })
beforeAll(async () => { expect(await isSemanticStoreAvailable()).toBe(true) })
const lower = [0.8, 0.6, ...Array<number>(1022).fill(0)]
async function put(index: { id: string; generation: number }, vector: number[]) {
  await testDb.$transaction(tx => writeSemanticVector(tx, { indexId: index.id, generation: index.generation, vector }))
}
describe('M9-T03 model/revision eligibility before vector LIMIT', () => {
  it.each(['model', 'revision'] as const)('filters stale student %s before LIMIT', async change => {
    const gate = await seedT03Gate(), employer = await t03Employer()
    const stale = await t03Student(), valid = await t03Student()
    const a = await readyT03Student(stale), b = await readyT03Student(valid)
    await put(a, T03_VECTOR); await put(b, lower)
    if (change === 'model') await testDb.semanticIndex.update({ where: { id: a.id }, data: { model: 'old-model' } })
    else await testDb.studentProfile.update({ where: { id: stale.profileId }, data: { editRevision: { increment: 1 } } })
    const rows = await findTalentNeighbors({ vector: T03_VECTOR, configurationId: T03_CONFIG, gateEpoch: gate.epoch, companyId: employer.companyId, limit: 1 })
    expect(rows.map(row => row.subjectId)).toEqual([valid.profileId])
  })
  it('filters a same-hash stale job revision before LIMIT', async () => {
    const gate = await seedT03Gate(), student = await t03Student()
    const stale = await t03Employer(), valid = await t03Employer()
    await put(await readyT03Job(stale), T03_VECTOR); await put(await readyT03Job(valid), lower)
    await testDb.job.update({ where: { id: stale.jobId }, data: { matchingRevision: { increment: 1 } } })
    const rows = await findJobNeighbors({ vector: T03_VECTOR, configurationId: T03_CONFIG, gateEpoch: gate.epoch, studentId: student.profileId, limit: 1 })
    expect(rows.map(row => row.subjectId)).toEqual([valid.jobId])
  })
})
