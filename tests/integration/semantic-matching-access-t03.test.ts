import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/server/db', async () => ({ db: (await import('../setup/db')).testDb }))
vi.mock('@/server/jobs/boss', () => ({ sendBoss: { start: vi.fn().mockResolvedValue(undefined), send: vi.fn().mockResolvedValue('synthetic-job') } }))
vi.mock('@/server/lib/ai/embedding-provider', () => ({ embedMatchingText: vi.fn() }))
vi.mock('@/server/lib/semantic-store', () => ({
  isSemanticStoreAvailable: vi.fn(), findTalentNeighbors: vi.fn(), findJobNeighbors: vi.fn(),
  writeSemanticVector: vi.fn().mockResolvedValue(undefined), deleteSemanticVector: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@/env', async importOriginal => {
  const actual = await importOriginal<typeof import('@/env')>()
  return { ...actual, env: { ...actual.env, VOYAGE_API_KEY: 'synthetic-key', AI_MODEL_EMBED: 'synthetic-embedding-model' } }
})

import { setupTestDb, testDb } from '../setup/db'
import { createStudent } from '../factories'
import { embedMatchingText } from '@/server/lib/ai/embedding-provider'
import { isSemanticStoreAvailable, findTalentNeighbors, findJobNeighbors } from '@/server/lib/semantic-store'
import { recommendJobs, recommendTalents, setMatchingConsent } from '@/server/services/semantic-matching'
import { clearSettingsCache, getSetting } from '@/server/services/settings'
import { addBlockedCompany, setVisibility } from '@/server/services/privacy'
import {
  seedT03Gate, t03Student, t03Employer, readyT03Student, readyT03Job,
  t03Neighbor, t03Deferred, t03Bounded, T03_VECTOR, T03_MODEL, T03_VERSION,
} from '../helpers/semantic-matching-t03'

setupTestDb()
beforeEach(() => {
  vi.clearAllMocks(); clearSettingsCache()
  vi.mocked(isSemanticStoreAvailable).mockReset().mockResolvedValue(true)
  vi.mocked(findTalentNeighbors).mockReset().mockResolvedValue([])
  vi.mocked(findJobNeighbors).mockReset().mockResolvedValue([])
  vi.mocked(embedMatchingText).mockReset().mockResolvedValue({ ok: true, vector: T03_VECTOR, model: T03_MODEL })
})

async function talentFixture() {
  await seedT03Gate()
  const employer = await t03Employer()
  const student = await t03Student()
  const index = await readyT03Student(student)
  vi.mocked(findTalentNeighbors).mockResolvedValue([t03Neighbor(index, student.profileId)])
  return { employer, student, index }
}

describe('M9-T03 recommendation access and output', () => {
  it('reuses current talent identity serialization without disclosing similarity/internal metadata or spending credits', async () => {
    const f = await talentFixture()
    const locked = await recommendTalents(f.employer, { jobId: f.employer.jobId })
    expect(locked.availability).toBe('ready')
    expect(locked.items).toHaveLength(1)
    expect(locked.items[0]).toMatchObject({ id: f.student.profileId, unlocked: false })
    expect(JSON.stringify(locked)).not.toContain(f.student.name)
    for (const key of ['distance', 'vector', 'sourceHash', 'leaseToken', 'configurationId', 'score', 'contact', 'resumePreview']) {
      expect(JSON.stringify(locked)).not.toContain('"' + key + '"')
    }
    await testDb.talentUnlock.create({ data: { companyId: f.employer.companyId, studentId: f.student.profileId, unlockedById: f.employer.userId, source: 'CREDIT' } })
    const unlocked = await recommendTalents(f.employer, { jobId: f.employer.jobId })
    expect(unlocked.items[0]).toMatchObject({ name: f.student.name, unlocked: true })
    expect(await testDb.creditLedger.count()).toBe(0)
    expect(await testDb.profileView.count()).toBe(0)
  })

  it.each(['hidden', 'unverified-school', 'incomplete', 'suspended', 'blocked', 'revoked', 'stale-hash', 'stale-config'] as const)(
    'rejects a stale repository candidate after %s', async reason => {
      const f = await talentFixture()
      if (reason === 'hidden') await setVisibility({ userId: f.student.userId }, { granted: false })
      if (reason === 'unverified-school') await testDb.studentProfile.update({ where: { id: f.student.profileId }, data: { schoolVerifiedAt: null } })
      if (reason === 'incomplete') await testDb.studentProfile.update({ where: { id: f.student.profileId }, data: { completeness: 59 } })
      if (reason === 'suspended') await testDb.user.update({ where: { id: f.student.userId }, data: { status: 'SUSPENDED' } })
      if (reason === 'blocked') await addBlockedCompany({ userId: f.student.userId }, { companyId: f.employer.companyId })
      if (reason === 'revoked') await setMatchingConsent({ userId: f.student.userId }, { granted: false, submittedVersion: T03_VERSION })
      if (reason === 'stale-hash') await testDb.studentProfile.update({ where: { id: f.student.profileId }, data: { headline: 'Changed after indexing' } })
      if (reason === 'stale-config') await testDb.semanticIndex.update({ where: { id: f.index.id }, data: { configurationId: 'old-config' } })
      const result = await recommendTalents(f.employer, { jobId: f.employer.jobId })
      expect(result.items).toEqual([])
    },
  )

  it.each(['company-inactive', 'company-unverified', 'member-removed', 'actor-suspended', 'actor-role-changed', 'foreign-job'] as const)(
    'denies %s even with a forged service context and makes no external call', async reason => {
      const f = await talentFixture()
      let jobId = f.employer.jobId
      if (reason === 'company-inactive') await testDb.company.update({ where: { id: f.employer.companyId }, data: { isActive: false } })
      if (reason === 'company-unverified') await testDb.company.update({ where: { id: f.employer.companyId }, data: { verificationStatus: 'UNSUBMITTED' } })
      if (reason === 'member-removed') await testDb.companyMember.deleteMany({ where: { userId: f.employer.userId, companyId: f.employer.companyId } })
      if (reason === 'actor-suspended') await testDb.user.update({ where: { id: f.employer.userId }, data: { status: 'SUSPENDED' } })
      if (reason === 'actor-role-changed') await testDb.user.update({ where: { id: f.employer.userId }, data: { role: 'STUDENT' } })
      if (reason === 'foreign-job') jobId = (await t03Employer()).jobId
      await expect(recommendTalents(f.employer, { jobId })).rejects.toMatchObject({ code: reason === 'foreign-job' ? 'NOT_FOUND' : 'FORBIDDEN' })
      expect(embedMatchingText).not.toHaveBeenCalled()
      expect(findTalentNeighbors).not.toHaveBeenCalled()
    },
  )

  it('shares the existing daily employer search-page rate bucket', async () => {
    const f = await talentFixture()
    await testDb.systemSetting.upsert({ where: { key: 'limits.searchPagesPerDay' }, create: { key: 'limits.searchPagesPerDay', value: 1 }, update: { value: 1 } })
    await recommendTalents(f.employer, { jobId: f.employer.jobId })
    await expect(recommendTalents(f.employer, { jobId: f.employer.jobId })).rejects.toMatchObject({ code: 'RATE_LIMITED' })
    expect(embedMatchingText).toHaveBeenCalledOnce()
    expect(await testDb.auditLog.count({ where: { actorId: f.employer.userId, action: 'talent.limit.hit' } })).toBe(1)
  })

  it('honors the existing talent-pool search feature gate before query egress', async () => {
    const f = await talentFixture()
    await testDb.systemSetting.upsert({ where: { key: 'talentPool.searchEnabled' }, create: { key: 'talentPool.searchEnabled', value: false }, update: { value: false } })
    await expect(recommendTalents(f.employer, { jobId: f.employer.jobId })).rejects.toMatchObject({ code: 'FEATURE_DISABLED' })
    expect(embedMatchingText).not.toHaveBeenCalled()
    expect(findTalentNeighbors).not.toHaveBeenCalled()
  })

  it.each(['gate-disabled', 'vector-absent'] as const)('returns unavailable with zero egress when %s', async reason => {
    const f = await talentFixture()
    await getSetting('ai.matching', null)
    if (reason === 'gate-disabled') await testDb.systemSetting.update({ where: { key: 'ai.matching' }, data: { value: { enabled: false } } })
    else vi.mocked(isSemanticStoreAvailable).mockResolvedValue(false)
    await expect(recommendTalents(f.employer, { jobId: f.employer.jobId })).resolves.toEqual({ availability: 'unavailable', items: [] })
    expect(embedMatchingText).not.toHaveBeenCalled()
    expect(findTalentNeighbors).not.toHaveBeenCalled()
  })

  it('rechecks membership after the external query embedding returns', async () => {
    const f = await talentFixture()
    const entered = t03Deferred<void>(), release = t03Deferred<void>()
    vi.mocked(embedMatchingText).mockImplementationOnce(async () => {
      entered.resolve(); await release.promise
      return { ok: true, vector: T03_VECTOR, model: T03_MODEL }
    })
    const work = recommendTalents(f.employer, { jobId: f.employer.jobId }).then(value => ({ value, error: null }), error => ({ value: null, error }))
    let result!: Awaited<typeof work>
    let mutation: Promise<unknown> | undefined
    try {
      await t03Bounded(entered.promise)
      mutation = testDb.companyMember.deleteMany({ where: { userId: f.employer.userId } })
      await t03Bounded(mutation)
    } finally {
      release.resolve()
      const results = await Promise.allSettled([t03Bounded(work).then(value => { result = value }), ...(mutation ? [t03Bounded(mutation)] : [])])
      for (const item of results) if (item.status === 'rejected') throw item.reason
    }
    expect(result.error).toMatchObject({ code: 'FORBIDDEN' })
    expect(result.value).toBeNull()
    expect(findTalentNeighbors).not.toHaveBeenCalled()
  })

  it('student results use only list projection and never consume or bypass exhausted detail quota', async () => {
    await seedT03Gate()
    const student = await t03Student(), employer = await t03Employer()
    const index = await readyT03Job(employer)
    await testDb.studentProfile.update({ where: { id: student.profileId }, data: { visibility: 'HIDDEN' } })
    await testDb.systemSetting.upsert({ where: { key: 'studentQuota.baseJobViews' }, create: { key: 'studentQuota.baseJobViews', value: 0 }, update: { value: 0 } })
    await testDb.job.update({ where: { id: employer.jobId }, data: {
      description: 'PRIVATE_JOB_BODY', requirements: 'PRIVATE_JOB_REQUIREMENTS', benefits: 'PRIVATE_JOB_BENEFITS', salaryVisible: false, salaryMax: 876543,
    } })
    vi.mocked(findJobNeighbors).mockResolvedValue([t03Neighbor(index, employer.jobId)])
    const result = await recommendJobs({ userId: student.userId }, {})
    expect(result.items).toHaveLength(1)
    expect(result.items[0]).toMatchObject({ id: employer.jobId, salaryMax: null })
    expect(JSON.stringify(result)).not.toMatch(/PRIVATE_JOB_|876543|description|requirements|benefits|distance/)
    expect(await testDb.jobView.count()).toBe(0)
    expect(await testDb.application.count()).toBe(0)
    expect(await testDb.invitation.count()).toBe(0)
    const [input] = vi.mocked(embedMatchingText).mock.calls[0]
    expect(input.inputType).toBe('query')
    expect(JSON.stringify(input)).not.toContain(student.name)
  })

  it.each(['closed', 'expired', 'inactive-company'] as const)('student cannot receive a stale %s job candidate', async change => {
    await seedT03Gate()
    const student = await t03Student(), employer = await t03Employer()
    const index = await readyT03Job(employer)
    if (change === 'closed') await testDb.job.update({ where: { id: employer.jobId }, data: { status: 'CLOSED' } })
    if (change === 'expired') await testDb.job.update({ where: { id: employer.jobId }, data: { deadline: new Date(Date.now() - 1_000) } })
    if (change === 'inactive-company') await testDb.company.update({ where: { id: employer.companyId }, data: { isActive: false } })
    vi.mocked(findJobNeighbors).mockResolvedValue([t03Neighbor(index, employer.jobId)])
    expect((await recommendJobs({ userId: student.userId }, {})).items).toEqual([])
  })

  it('student without a matching grant cannot use a parse/talent/terms grant as substitute', async () => {
    await seedT03Gate()
    const student = await createStudent(testDb)
    await testDb.consent.createMany({ data: ['TERMS', 'PRIVACY', 'TALENT_POOL', 'AI_RESUME_PARSE'].map(type => ({
      userId: student.userId, type: type as 'TERMS' | 'PRIVACY' | 'TALENT_POOL' | 'AI_RESUME_PARSE', granted: true, version: T03_VERSION,
    })) })
    await expect(recommendJobs({ userId: student.userId }, {})).rejects.toMatchObject({ code: 'FORBIDDEN' })
    expect(embedMatchingText).not.toHaveBeenCalled()
  })

  it.each(['EMPLOYER', 'ADMIN', 'SUSPENDED'] as const)('denies job recommendations to %s before query egress', async actor => {
    await seedT03Gate()
    const user = await t03Student()
    await testDb.user.update({ where: { id: user.userId }, data: actor === 'SUSPENDED' ? { status: 'SUSPENDED' } : { role: actor } })
    await expect(recommendJobs({ userId: user.userId }, {})).rejects.toMatchObject({ code: 'FORBIDDEN' })
    expect(embedMatchingText).not.toHaveBeenCalled()
    expect(findJobNeighbors).not.toHaveBeenCalled()
  })

  it('does not reuse a student query after revoke and regrant while the provider waits', async () => {
    await seedT03Gate()
    const student = await t03Student()
    const entered = t03Deferred<void>(), release = t03Deferred<void>()
    vi.mocked(embedMatchingText).mockImplementationOnce(async () => {
      entered.resolve(); await release.promise
      return { ok: true, vector: T03_VECTOR, model: T03_MODEL }
    })
    const work = recommendJobs({ userId: student.userId }, {}).then(value => ({ value, error: null }), error => ({ value: null, error }))
    let result!: Awaited<typeof work>
    let mutation: Promise<void> | undefined
    try {
      await t03Bounded(entered.promise)
      mutation = (async () => {
        await setMatchingConsent({ userId: student.userId }, { granted: false, submittedVersion: T03_VERSION })
        await setMatchingConsent({ userId: student.userId }, { granted: true, submittedVersion: T03_VERSION })
      })()
      await t03Bounded(mutation)
    } finally {
      release.resolve()
      const results = await Promise.allSettled([t03Bounded(work).then(value => { result = value }), ...(mutation ? [t03Bounded(mutation)] : [])])
      for (const item of results) if (item.status === 'rejected') throw item.reason
    }
    expect(result.error).toMatchObject({ code: 'CONFLICT' })
    expect(result.value).toBeNull()
    expect(findJobNeighbors).not.toHaveBeenCalled()
  })

  it('sorts equal distances by ID, deduplicates neighbors, and excludes nonfinite distance', async () => {
    const f = await talentFixture()
    const second = await t03Student(), secondIndex = await readyT03Student(second)
    const rows = [t03Neighbor(f.index, f.student.profileId, 0.2), t03Neighbor(secondIndex, second.profileId, 0.2)]
    vi.mocked(findTalentNeighbors).mockResolvedValue([rows[1], rows[0], rows[1], { ...rows[0], distance: NaN }])
    const result = await recommendTalents(f.employer, { jobId: f.employer.jobId })
    expect(result.items.map(item => item.id)).toEqual([f.student.profileId, second.profileId].sort())
  })
})
