import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
vi.mock('@/server/db', async () => ({ db: (await import('../setup/db')).testDb }))
vi.mock('@/server/jobs/boss', () => ({ sendBoss: { start: vi.fn().mockResolvedValue(undefined), send: vi.fn().mockResolvedValue('synthetic-job') } }))
vi.mock('@/server/lib/ai/embedding-provider', () => ({ embedMatchingText: vi.fn(() => { throw new Error('Provider egress is forbidden in vector-store tests') }) }))
vi.mock('@/env', async importOriginal => {
  const actual = await importOriginal<typeof import('@/env')>()
  return { ...actual, env: { ...actual.env, VOYAGE_API_KEY: 'synthetic-key', AI_MODEL_EMBED: 'synthetic-embedding-model' } }
})

import { setupTestDb, testDb } from '../setup/db'
import { isSemanticStoreAvailable, findTalentNeighbors, findJobNeighbors, writeSemanticVector } from '@/server/lib/semantic-store'
import { clearSettingsCache } from '@/server/services/settings'
import {
  seedT03Gate, t03Employer, t03Student, readyT03Student, readyT03Job,
  T03_VECTOR, T03_CONFIG, T03_VERSION,
} from '../helpers/semantic-matching-t03'

setupTestDb()
beforeEach(() => { clearSettingsCache() })
beforeAll(async () => {
  // Missing extension/table is a hard error in this explicit environment, never an it.skip.
  expect(await isSemanticStoreAvailable()).toBe(true)
  const extensions = await testDb.$queryRaw<Array<{ extversion: string }>>`SELECT extversion FROM pg_extension WHERE extname = 'vector'`
  expect(extensions).toEqual([{ extversion: '0.8.7' }])
})

async function put(index: { id: string; generation: number }, vector: number[]) {
  await testDb.$transaction(tx => writeSemanticVector(tx, { indexId: index.id, generation: index.generation, vector }))
}

describe('M9-T03 real pgvector filtering and transactions', () => {
  it('filters hidden/blocked rows before LIMIT and gives stable cosine ordering', async () => {
    const gate = await seedT03Gate(), employer = await t03Employer()
    const hidden = await t03Student(), blocked = await t03Student(), a = await t03Student(), b = await t03Student()
    const ih = await readyT03Student(hidden), ib = await readyT03Student(blocked)
    const ia = await readyT03Student(a), ii = await readyT03Student(b)
    await put(ih, T03_VECTOR); await put(ib, T03_VECTOR)
    const tie = [0.8, 0.6, ...Array<number>(1022).fill(0)]
    await put(ia, tie); await put(ii, tie)
    await testDb.studentProfile.update({ where: { id: hidden.profileId }, data: { visibility: 'HIDDEN' } })
    await testDb.blockedCompany.create({ data: { studentId: blocked.profileId, companyId: employer.companyId } })
    const rows = await findTalentNeighbors({ vector: T03_VECTOR, configurationId: T03_CONFIG, gateEpoch: gate.epoch, companyId: employer.companyId, limit: 2 })
    expect(rows.map(row => row.subjectId)).toEqual([a.profileId, b.profileId].sort())
    for (const row of rows) expect(row.distance).toBeCloseTo(0.2, 5)
  })

  it.each(['latest-revoke', 'old-config', 'old-generation'] as const)('excludes stale %s metadata even when a vector remains', async reason => {
    const gate = await seedT03Gate(), employer = await t03Employer(), student = await t03Student()
    const index = await readyT03Student(student)
    await put(index, T03_VECTOR)
    if (reason === 'latest-revoke') {
      const last = await testDb.consent.findFirstOrThrow({ where: { userId: student.userId, type: 'AI_MATCHING' }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] })
      await testDb.consent.create({ data: {
        userId: student.userId, type: 'AI_MATCHING', granted: false, version: T03_VERSION + '-older', createdAt: new Date(last.createdAt.getTime() + 1),
      } })
    }
    if (reason === 'old-config') await testDb.semanticIndex.update({ where: { id: index.id }, data: { configurationId: 'old-config' } })
    if (reason === 'old-generation') await testDb.semanticIndex.update({ where: { id: index.id }, data: { generation: { increment: 1 } } })
    expect(await findTalentNeighbors({ vector: T03_VECTOR, configurationId: T03_CONFIG, gateEpoch: gate.epoch, companyId: employer.companyId, limit: 2 })).toEqual([])
  })

  it.each(['closed', 'expired', 'inactive-company'] as const)('filters %s jobs before LIMIT', async reason => {
    const gate = await seedT03Gate(), student = await t03Student()
    const invalid = await t03Employer(), valid = await t03Employer()
    await put(await readyT03Job(invalid), T03_VECTOR)
    await put(await readyT03Job(valid), [0.8, 0.6, ...Array<number>(1022).fill(0)])
    if (reason === 'closed') await testDb.job.update({ where: { id: invalid.jobId }, data: { status: 'CLOSED' } })
    if (reason === 'expired') await testDb.job.update({ where: { id: invalid.jobId }, data: { deadline: new Date(Date.now() - 1_000) } })
    if (reason === 'inactive-company') await testDb.company.update({ where: { id: invalid.companyId }, data: { isActive: false } })
    const rows = await findJobNeighbors({ vector: T03_VECTOR, configurationId: T03_CONFIG, gateEpoch: gate.epoch, studentId: student.profileId, limit: 1 })
    expect(rows.map(row => row.subjectId)).toEqual([valid.jobId])
  })

  it('rolls back vector publication with its transaction and cascades after source deletion', async () => {
    await seedT03Gate()
    const student = await t03Student(), index = await readyT03Student(student)
    await expect(testDb.$transaction(async tx => {
      await writeSemanticVector(tx, { indexId: index.id, generation: index.generation, vector: T03_VECTOR })
      throw new Error('synthetic-rollback')
    })).rejects.toThrow('synthetic-rollback')
    const before = await testDb.$queryRaw<Array<{ count: number }>>`SELECT count(*)::int AS count FROM semantic_vectors WHERE "indexId" = ${index.id}`
    expect(before).toEqual([{ count: 0 }])
    await put(index, T03_VECTOR)
    await testDb.studentProfile.delete({ where: { id: student.profileId } })
    const after = await testDb.$queryRaw<Array<{ count: number }>>`SELECT count(*)::int AS count FROM semantic_vectors WHERE "indexId" = ${index.id}`
    expect(after).toEqual([{ count: 0 }])
  })
})
