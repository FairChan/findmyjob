import { Prisma } from '@prisma/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/server/db', async () => ({ db: (await import('../setup/db')).testDb }))
vi.mock('@/server/jobs/boss', () => ({ sendBoss: {
  start: vi.fn().mockResolvedValue(undefined), send: vi.fn().mockResolvedValue('synthetic-queue-job'),
} }))
vi.mock('@/server/lib/rate-limit', () => ({ checkRateLimit: vi.fn() }))
vi.mock('@/lib/storage', () => ({
  getObjectBytes: vi.fn(), deleteAllVersions: vi.fn().mockResolvedValue(undefined),
} ))
vi.mock('@/server/services/notify', () => ({ sendNotificationEmail: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/server/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() } }))
vi.mock('@/env', async importOriginal => {
  const actual = await importOriginal<typeof import('@/env')>()
  return { ...actual, env: { ...actual.env, ANTHROPIC_API_KEY: 'synthetic-test-key', AI_MODEL_PARSE: 'synthetic-test-model' } }
})

import { setupTestDb, testDb } from '../setup/db'
import { getObjectBytes } from '@/lib/storage'
import { sendBoss } from '@/server/jobs/boss'
import { checkRateLimit } from '@/server/lib/rate-limit'
import { requestResumeParse } from '@/server/services/resume-parsing'
import * as settings from '@/server/services/settings'
import {
  readyT01Resume, seedT01Gate, seedT01Resume, seedT01Student, T01_BYTES,
} from '../helpers/resume-parsing-t01'

const QUOTA_KEY = 'limits.resumeParsesPerHour'
const ALLOWED = { allowed: true, remaining: 2, resetAt: 3_600_000, count: 1 }
const DENIED = { allowed: false, remaining: 0, resetAt: 3_600_000, count: 4 }

setupTestDb()
beforeEach(() => {
  vi.clearAllMocks()
  settings.clearSettingsCache()
  vi.mocked(checkRateLimit).mockReset().mockResolvedValue(ALLOWED)
  vi.mocked(getObjectBytes).mockReset().mockResolvedValue(T01_BYTES)
})
afterEach(() => { vi.restoreAllMocks() })

async function setQuota(value: Prisma.InputJsonValue | null) {
  const json = value === null ? Prisma.JsonNull : value
  await testDb.systemSetting.upsert({
    where: { key: QUOTA_KEY }, create: { key: QUOTA_KEY, value: json }, update: { value: json },
  })
}

async function requestFixture(legacy = false) {
  await seedT01Gate()
  const student = await seedT01Student()
  const resume = await seedT01Resume(student)
  if (legacy) await testDb.resumeFile.update({ where: { id: resume.id }, data: { contentSha256: null } })
  return { student, resume, ctx: { userId: student.userId } }
}

async function terminalFixture(state: 'FAILED' | 'CANCELLED') {
  const f = await requestFixture()
  await requestResumeParse(f.ctx, { resumeId: f.resume.id })
  const draft = await testDb.resumeParseDraft.update({
    where: { resumeId: f.resume.id }, data: { state, completedAt: new Date() },
  })
  vi.mocked(checkRateLimit).mockClear()
  vi.mocked(sendBoss.start).mockClear()
  vi.mocked(sendBoss.send).mockClear()
  return { ...f, draft }
}

describe('M9-T01 configurable request quota', () => {
  it('defaults to three per hour only when the setting row is absent', async () => {
    const f = await requestFixture()
    expect(await testDb.systemSetting.findUnique({ where: { key: QUOTA_KEY } })).toBeNull()
    await expect(requestResumeParse(f.ctx, { resumeId: f.resume.id }))
      .resolves.toMatchObject({ generation: 1, state: 'QUEUED', dispatch: 'submitted' })
    expect(checkRateLimit).toHaveBeenCalledExactlyOnceWith(`resume-parse:${f.student.userId}`, {
      windowMs: 3_600_000, limit: 3,
    })
  })

  it.each([1, 7, 100])('passes configured quota %s to the existing per-user limiter', async limit => {
    const f = await requestFixture()
    await setQuota(limit)
    await requestResumeParse(f.ctx, { resumeId: f.resume.id })
    expect(checkRateLimit).toHaveBeenCalledExactlyOnceWith(`resume-parse:${f.student.userId}`, {
      windowMs: 3_600_000, limit,
    })
    expect(sendBoss.send).toHaveBeenCalledExactlyOnceWith('resume-parse', { resumeId: f.resume.id, generation: 1 })
  })

  it.each([false, true])('zero blocks a new generation before storage or bucket I/O (legacy=%s)', async legacy => {
    const f = await requestFixture(legacy)
    await setQuota(0)
    await expect(requestResumeParse(f.ctx, { resumeId: f.resume.id })).rejects.toMatchObject({ code: 'RATE_LIMITED' })
    expect(await testDb.resumeParseDraft.findUnique({ where: { resumeId: f.resume.id } })).toBeNull()
    expect(checkRateLimit).not.toHaveBeenCalled()
    expect(getObjectBytes).not.toHaveBeenCalled()
    expect(sendBoss.start).not.toHaveBeenCalled()
    expect(sendBoss.send).not.toHaveBeenCalled()
  })

  it.each([-1, 101, 1.5, '3', null, true, {}, []].map(value => ({ value })))('fails closed for malformed quota $value', async ({ value }) => {
    const f = await requestFixture(true)
    await setQuota(value)
    await expect(requestResumeParse(f.ctx, { resumeId: f.resume.id })).rejects.toMatchObject({ code: 'FEATURE_DISABLED' })
    expect(await testDb.resumeParseDraft.findUnique({ where: { resumeId: f.resume.id } })).toBeNull()
    expect(checkRateLimit).not.toHaveBeenCalled()
    expect(getObjectBytes).not.toHaveBeenCalled()
    expect(sendBoss.start).not.toHaveBeenCalled()
    expect(sendBoss.send).not.toHaveBeenCalled()
  })

  it('bypasses a warmed global settings cache using the active transaction', async () => {
    const f = await requestFixture()
    await setQuota(9)
    expect(await settings.getSetting(QUOTA_KEY, 3)).toBe(9)
    await setQuota(2)
    expect(await settings.getSetting(QUOTA_KEY, 3)).toBe(9)
    const reader = vi.spyOn(settings, 'getSetting')
    await requestResumeParse(f.ctx, { resumeId: f.resume.id })
    expect(checkRateLimit).toHaveBeenCalledExactlyOnceWith(`resume-parse:${f.student.userId}`, {
      windowMs: 3_600_000, limit: 2,
    })
    const quotaReads = reader.mock.calls.filter(([key]) => key === QUOTA_KEY)
    expect(quotaReads).toHaveLength(1)
    expect(quotaReads[0][1]).toBe(3)
    expect(quotaReads[0][2]).toMatchObject({ fresh: true, tx: expect.objectContaining({ systemSetting: expect.anything() }) })
    expect(quotaReads[0][2]?.tx).not.toBe(testDb)
  })

  it.each((['QUEUED', 'PROCESSING', 'READY'] as const).flatMap(state => [
    { state, quota: 0 }, { state, quota: 'invalid' },
  ]))('replays $state at quota $quota without consuming quota or changing the draft', async ({ state, quota }) => {
    await seedT01Gate()
    const student = await seedT01Student()
    const ready = await readyT01Resume(student)
    const before = await testDb.resumeParseDraft.update({
      where: { resumeId: ready.resume.id },
      data: { state, leaseToken: state === 'PROCESSING' ? 'synthetic-lease' : null,
        leaseExpiresAt: state === 'PROCESSING' ? new Date(Date.now() + 60_000) : null },
    })
    await setQuota(quota)
    vi.mocked(checkRateLimit).mockClear()
    vi.mocked(sendBoss.start).mockClear()
    vi.mocked(sendBoss.send).mockClear()
    const reader = vi.spyOn(settings, 'getSetting')
    await expect(requestResumeParse({ userId: student.userId }, {
      resumeId: ready.resume.id, expectedGeneration: before.generation,
    })).resolves.toMatchObject({ resumeId: ready.resume.id, generation: before.generation, state })
    expect(await testDb.resumeParseDraft.findUniqueOrThrow({ where: { resumeId: ready.resume.id } })).toEqual(before)
    expect(reader.mock.calls.filter(([key]) => key === QUOTA_KEY)).toHaveLength(0)
    expect(checkRateLimit).not.toHaveBeenCalled()
    expect(getObjectBytes).not.toHaveBeenCalled()
    expect(sendBoss.send).toHaveBeenCalledTimes(state === 'QUEUED' ? 1 : 0)
    expect(vi.mocked(sendBoss.send).mock.calls).toEqual(state === 'QUEUED'
      ? [['resume-parse', { resumeId: ready.resume.id, generation: before.generation }]] : [])
  })

  it.each(['FAILED', 'CANCELLED'] as const)('charges a configured quota once for a restarted %s generation', async state => {
    const f = await terminalFixture(state)
    await setQuota(6)
    await expect(requestResumeParse(f.ctx, { resumeId: f.resume.id, expectedGeneration: f.draft.generation }))
      .resolves.toMatchObject({ generation: f.draft.generation + 1, state: 'QUEUED' })
    expect(checkRateLimit).toHaveBeenCalledExactlyOnceWith(`resume-parse:${f.student.userId}`, {
      windowMs: 3_600_000, limit: 6,
    })
    expect(sendBoss.send).toHaveBeenCalledExactlyOnceWith('resume-parse', {
      resumeId: f.resume.id, generation: f.draft.generation + 1,
    })
  })

  it('does not create or dispatch a new draft when the configured limiter denies it', async () => {
    const f = await requestFixture()
    await setQuota(2)
    vi.mocked(checkRateLimit).mockResolvedValueOnce(DENIED)
    await expect(requestResumeParse(f.ctx, { resumeId: f.resume.id })).rejects.toMatchObject({ code: 'RATE_LIMITED' })
    expect(checkRateLimit).toHaveBeenCalledExactlyOnceWith(`resume-parse:${f.student.userId}`, {
      windowMs: 3_600_000, limit: 2,
    })
    expect(await testDb.resumeParseDraft.findUnique({ where: { resumeId: f.resume.id } })).toBeNull()
    expect(sendBoss.start).not.toHaveBeenCalled()
    expect(sendBoss.send).not.toHaveBeenCalled()
  })

  it.each(['FAILED', 'CANCELLED'] as const)('preserves a %s draft when its restart is rate limited', async state => {
    const f = await terminalFixture(state)
    await setQuota(1)
    vi.mocked(checkRateLimit).mockResolvedValueOnce(DENIED)
    await expect(requestResumeParse(f.ctx, { resumeId: f.resume.id, expectedGeneration: f.draft.generation }))
      .rejects.toMatchObject({ code: 'RATE_LIMITED' })
    expect(checkRateLimit).toHaveBeenCalledExactlyOnceWith(`resume-parse:${f.student.userId}`, {
      windowMs: 3_600_000, limit: 1,
    })
    expect(await testDb.resumeParseDraft.findUniqueOrThrow({ where: { resumeId: f.resume.id } })).toEqual(f.draft)
    expect(sendBoss.start).not.toHaveBeenCalled()
    expect(sendBoss.send).not.toHaveBeenCalled()
  })

  it('reads the current quota in both legacy-hash transactions and charges only once', async () => {
    const f = await requestFixture(true)
    await setQuota(4)
    const reader = vi.spyOn(settings, 'getSetting')
    await requestResumeParse(f.ctx, { resumeId: f.resume.id })
    expect(getObjectBytes).toHaveBeenCalledOnce()
    expect(reader.mock.calls.filter(([key]) => key === QUOTA_KEY)).toHaveLength(2)
    expect(checkRateLimit).toHaveBeenCalledExactlyOnceWith(`resume-parse:${f.student.userId}`, {
      windowMs: 3_600_000, limit: 4,
    })
    expect(sendBoss.send).toHaveBeenCalledExactlyOnceWith('resume-parse', { resumeId: f.resume.id, generation: 1 })
  })

  it.each([
    { quota: 0, code: 'RATE_LIMITED' }, { quota: 'invalid', code: 'FEATURE_DISABLED' },
  ])('rechecks quota after legacy storage I/O ($code)', async ({ quota, code }) => {
    const f = await requestFixture(true)
    await setQuota(3)
    vi.mocked(getObjectBytes).mockImplementationOnce(async () => {
      await setQuota(quota)
      return T01_BYTES
    })
    await expect(requestResumeParse(f.ctx, { resumeId: f.resume.id })).rejects.toMatchObject({ code })
    expect(getObjectBytes).toHaveBeenCalledOnce()
    expect(checkRateLimit).not.toHaveBeenCalled()
    expect(await testDb.resumeParseDraft.findUnique({ where: { resumeId: f.resume.id } })).toBeNull()
    expect(sendBoss.start).not.toHaveBeenCalled()
    expect(sendBoss.send).not.toHaveBeenCalled()
  })
})
