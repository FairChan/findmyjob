/**
 * Integration tests for job-view-quota service.
 * Uses the real test DB; does NOT mock lockXact or $transaction.
 * Verifies the advisory lock prevents concurrent over-consumption of quota.
 *
 * Fix 5.1 (M2-T12): only 1 of 2 concurrent opens succeeds when quota = 1 remaining
 */
import { vi, describe, it, expect } from 'vitest'

vi.mock('@/env', () => ({ env: {} }))

vi.mock('@/server/db', async () => {
  const { testDb } = await import('../setup/db')
  return { db: testDb }
})

const mockGetSetting = vi.hoisted(() => vi.fn())
vi.mock('@/server/services/settings', () => ({ getSetting: mockGetSetting }))

import { setupTestDb, testDb } from '../setup/db'
import { createStudent, createEmployer, createJob, faker, FAKER_SEED } from '../factories'
import { openJob } from '@/server/services/job-view-quota'

setupTestDb()

function setupSettings(base = 2) {
  faker.seed(FAKER_SEED)
  mockGetSetting.mockImplementation((key: string, def: unknown) => {
    const map: Record<string, unknown> = {
      'studentQuota.enabled': true,
      'studentQuota.baseJobViews': base,
      'studentQuota.tierSize': 3,
      'studentQuota.tierBonus': 10,
      'studentQuota.unlimitedAt': 12,
    }
    return Promise.resolve(key in map ? map[key] : def)
  })
}

describe('openJob — concurrent opens with 1 quota remaining (M2-T12 fix 5.1)', () => {
  it('exactly 1 of 2 concurrent new-job opens succeeds when quota has 1 slot left', async () => {
    // base quota = 2; student has used 1 → 1 slot remaining
    setupSettings(2)
    const student = await createStudent(testDb)
    const employer = await createEmployer(testDb)
    const job1 = await createJob(testDb, employer.companyId, employer.userId)
    const job2 = await createJob(testDb, employer.companyId, employer.userId)

    // Create 1 existing view (uses 1 of 2 base slots)
    const existingJob = await createJob(testDb, employer.companyId, employer.userId)
    await testDb.jobView.create({ data: { studentId: student.profileId, jobId: existingJob.id } })

    // Now concurrent opens of 2 new jobs — only 1 should succeed
    const [result1, result2] = await Promise.all([
      openJob(student.profileId, job1.id),
      openJob(student.profileId, job2.id),
    ])

    const successes = [result1, result2].filter((r) => r.allowed)
    const failures = [result1, result2].filter((r) => !r.allowed)

    expect(successes).toHaveLength(1)
    expect(failures).toHaveLength(1)

    // Exactly 1 JobView row should have been created (the successful one)
    const viewCount = await testDb.jobView.count({ where: { studentId: student.profileId } })
    expect(viewCount).toBe(2) // 1 pre-existing + 1 new
  })
})
