import { randomUUID } from 'node:crypto'
import type { CompanyMemberRole, Prisma } from '@prisma/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const config = vi.hoisted(() => ({ model: 'synthetic-jd-model', key: 'synthetic-jd-key' }))
vi.mock('@/server/db', async () => ({ db: (await import('../setup/db')).testDb }))
vi.mock('@/server/lib/ai/jd-provider', () => ({ generateJdSuggestion: vi.fn() }))
vi.mock('@/env', async importOriginal => {
  const actual = await importOriginal<typeof import('@/env')>()
  return { ...actual, env: {
    ...actual.env, get ANTHROPIC_API_KEY() { return config.key }, get AI_MODEL_JD() { return config.model },
  } }
})
vi.mock('@/server/lib/logger', () => ({ logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() } }))

import { setupTestDb, testDb } from '../setup/db'
import { createEmployer, createEmployerWithoutCompany, createJob, createStudent } from '../factories'
import type { CompanyCtx } from '@/server/authz'
import { generateJobDescription, getJdAssistantAvailability } from '@/server/services/jd-assistant'
import { generateJdSuggestion, type JdProviderResult } from '@/server/lib/ai/jd-provider'
import type { GenerateJobDescriptionInput } from '@/server/schemas/jd-assistant'
import { clearSettingsCache, getSetting } from '@/server/services/settings'
import { logger } from '@/server/lib/logger'

setupTestDb()
const VERSION = 'm9-t02-synthetic-policy'
const INPUT = { title: 'Software intern', points: 'Build and review application features', acknowledged: true as const, submittedVersion: VERSION }
const OUTPUT = { zh: '协助构建与审查应用功能。', en: 'Help build and review application features.' }
const provider = vi.mocked(generateJdSuggestion)

beforeEach(() => {
  vi.clearAllMocks()
  clearSettingsCache()
  config.model = 'synthetic-jd-model'
  config.key = 'synthetic-jd-key'
  provider.mockReset().mockResolvedValue({ ok: true, output: OUTPUT })
})

async function setting(key: string, value: Prisma.InputJsonValue) {
  await testDb.systemSetting.upsert({ where: { key }, create: { key, value }, update: { value } })
}
async function legal(userId: string) {
  await testDb.consent.createMany({ data: (['TERMS', 'PRIVACY'] as const).map(type => ({
    userId, type, granted: true, version: VERSION,
  })) })
}
async function fixture(role: CompanyMemberRole = 'RECRUITER') {
  const employer = await createEmployer(testDb)
  await testDb.companyMember.update({ where: { userId: employer.userId }, data: { role } })
  await legal(employer.userId)
  const gate = { enabled: true, legalVersion: VERSION, epoch: randomUUID() }
  await setting('ai.jdAssistant', gate)
  await setting('legal.currentVersion', VERSION)
  return { ...employer, gate, ctx: { userId: employer.userId, companyId: employer.companyId, role } satisfies CompanyCtx }
}
async function buckets() {
  return testDb.rateLimitBucket.findMany({ where: { key: { startsWith: 'ai-jd:' } }, orderBy: { key: 'asc' } })
}
async function bounded<T>(promise: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([promise, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('Synthetic JD boundary did not settle')), 3000)
    })])
  } finally { if (timer) clearTimeout(timer) }
}

describe('M9-T02 current company identity', () => {
  it.each(['OWNER', 'ADMIN', 'RECRUITER'] as const)('allows current %s at an unverified active company', async role => {
    const f = await fixture(role)
    expect((await testDb.company.findUniqueOrThrow({ where: { id: f.companyId } })).verificationStatus).toBe('UNSUBMITTED')
    await expect(generateJobDescription({ ...f.ctx, role: 'OWNER' }, INPUT)).resolves.toEqual(OUTPUT)
    expect(provider).toHaveBeenCalledTimes(1)
    expect(await getJdAssistantAvailability(f.ctx)).toEqual({ submittedVersion: VERSION })
  })

  it.each(['nonmember', 'removed', 'suspended', 'deleted', 'inactive-company', 'student', 'anonymous'] as const)(
    'rejects %s before reservation or provider', async condition => {
      const f = await fixture()
      let ctx = f.ctx
      if (condition === 'nonmember') ctx = { ...ctx, userId: (await createEmployerWithoutCompany(testDb)).userId }
      if (condition === 'removed') await testDb.companyMember.delete({ where: { userId: f.userId } })
      if (condition === 'suspended' || condition === 'deleted') await testDb.user.update({
        where: { id: f.userId }, data: { status: condition === 'suspended' ? 'SUSPENDED' : 'DELETED' },
      })
      if (condition === 'inactive-company') await testDb.company.update({ where: { id: f.companyId }, data: { isActive: false } })
      if (condition === 'student') {
        const student = await createStudent(testDb)
        await testDb.companyMember.create({ data: { companyId: f.companyId, userId: student.userId, role: 'OWNER' } })
        ctx = { ...ctx, userId: student.userId }
      }
      if (condition === 'anonymous') ctx = { ...ctx, userId: '' }
      await expect(generateJobDescription(ctx, INPUT)).rejects.toMatchObject({ code: 'FORBIDDEN' })
      expect(provider).not.toHaveBeenCalled()
      expect(await buckets()).toEqual([])
    },
  )
})

describe('M9-T02 input, current gate and legal consent', () => {
  it.each([
    { name: 'empty title', patch: { title: ' ' } },
    { name: 'oversized title', patch: { title: 'x'.repeat(201) } },
    { name: 'empty points', patch: { points: '' } },
    { name: 'oversized points', patch: { points: 'x'.repeat(3001) } },
    { name: 'no acknowledgement', patch: { acknowledged: false } },
    { name: 'caller company override', patch: { companyId: 'injected' } },
    { name: 'caller prompt override', patch: { system: 'injected' } },
    { name: 'contact-only input', patch: { points: 'alice@example.com' } },
  ])('rejects $name without spending a request', async ({ patch }) => {
    const f = await fixture()
    await expect(generateJobDescription(f.ctx, { ...INPUT, ...patch } as GenerateJobDescriptionInput))
      .rejects.toMatchObject({ code: 'VALIDATION_ERROR' })
    expect(provider).not.toHaveBeenCalled()
    expect(await buckets()).toEqual([])
  })

  it.each(['missing', 'disabled', 'malformed', 'missing-model', 'missing-key', 'invalid-limit', 'oversized-limit'] as const)(
    'fails closed for %s configuration', async condition => {
      const f = await fixture()
      await getSetting('ai.jdAssistant', null) // Warm the process cache before changing the durable value.
      if (condition === 'missing') await testDb.systemSetting.delete({ where: { key: 'ai.jdAssistant' } })
      if (condition === 'disabled') await setting('ai.jdAssistant', { ...f.gate, enabled: false })
      if (condition === 'malformed') await setting('ai.jdAssistant', { ...f.gate, unexpected: true })
      if (condition === 'missing-model') config.model = ''
      if (condition === 'missing-key') config.key = ''
      if (condition === 'invalid-limit') await setting('limits.aiJdPerUserPerHour', 1.5)
      if (condition === 'oversized-limit') await setting('limits.aiJdPerCompanyPerHour', 1001)
      await expect(generateJobDescription(f.ctx, INPUT)).rejects.toMatchObject({ code: 'FEATURE_DISABLED' })
      expect(await getJdAssistantAvailability(f.ctx)).toBeNull()
      expect(provider).not.toHaveBeenCalled()
      expect(await buckets()).toEqual([])
    },
  )

  it.each(['submitted-version', 'gate-version', 'consent-version', 'withdrawn-privacy', 'missing-terms'] as const)(
    'checks %s independently of the page', async condition => {
      const f = await fixture()
      let input = INPUT
      if (condition === 'submitted-version') input = { ...INPUT, submittedVersion: 'old-policy' }
      if (condition === 'gate-version') await setting('ai.jdAssistant', { ...f.gate, legalVersion: 'old-policy' })
      if (condition === 'consent-version') await testDb.consent.updateMany({ where: { userId: f.userId, type: 'TERMS' }, data: { version: 'old-policy' } })
      if (condition === 'withdrawn-privacy') await testDb.consent.updateMany({ where: { userId: f.userId, type: 'PRIVACY' }, data: { granted: false } })
      if (condition === 'missing-terms') await testDb.consent.deleteMany({ where: { userId: f.userId, type: 'TERMS' } })
      const code = condition === 'withdrawn-privacy' || condition === 'missing-terms' ? 'FORBIDDEN' : 'VERSION_MISMATCH'
      await expect(generateJobDescription(f.ctx, input)).rejects.toMatchObject({ code })
      expect(provider).not.toHaveBeenCalled()
      expect(await buckets()).toEqual([])
    },
  )
})

describe('M9-T02 durable reservations', () => {
  it('enforces a shared user window under concurrent requests', async () => {
    const f = await fixture()
    await setting('limits.aiJdPerUserPerHour', 2)
    await setting('limits.aiJdPerCompanyPerHour', 30)
    const clock = vi.spyOn(Date, 'now').mockReturnValue(Math.floor(Date.now() / 3_600_000) * 3_600_000 + 1_800_000)
    let results: PromiseSettledResult<unknown>[]
    try { results = await Promise.allSettled(Array.from({ length: 6 }, () => generateJobDescription(f.ctx, INPUT))) }
    finally { clock.mockRestore() }
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(2)
    expect(results.filter(result => result.status === 'rejected').map(result => result.reason.code))
      .toEqual(['RATE_LIMITED', 'RATE_LIMITED', 'RATE_LIMITED', 'RATE_LIMITED'])
    expect(provider).toHaveBeenCalledTimes(2)
    expect(await testDb.rateLimitBucket.findFirst({ where: { key: `ai-jd:user:${f.userId}` } })).toMatchObject({ count: 6 })
  })

  it('enforces one company window across different current members', async () => {
    const f = await fixture()
    const other = await createEmployerWithoutCompany(testDb)
    await testDb.companyMember.create({ data: { userId: other.userId, companyId: f.companyId, role: 'RECRUITER' } })
    await legal(other.userId)
    await setting('limits.aiJdPerCompanyPerHour', 2)
    const contexts = [f.ctx, { ...f.ctx, userId: other.userId }]
    const clock = vi.spyOn(Date, 'now').mockReturnValue(Math.floor(Date.now() / 3_600_000) * 3_600_000 + 1_800_000)
    let results: PromiseSettledResult<unknown>[]
    try { results = await Promise.allSettled(Array.from({ length: 6 }, (_, index) => generateJobDescription(contexts[index % 2]!, INPUT))) }
    finally { clock.mockRestore() }
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(2)
    expect(provider).toHaveBeenCalledTimes(2)
    expect(await testDb.rateLimitBucket.findFirst({ where: { key: `ai-jd:company:${f.companyId}` } })).toMatchObject({ count: 6 })
  })

  it('charges a failed provider attempt and does not retry automatically', async () => {
    const f = await fixture()
    await setting('limits.aiJdPerUserPerHour', 1)
    provider.mockResolvedValue({ ok: false, reason: 'unavailable' })
    await expect(generateJobDescription(f.ctx, INPUT)).rejects.toMatchObject({ code: 'AI_UNAVAILABLE' })
    await expect(generateJobDescription(f.ctx, INPUT)).rejects.toMatchObject({ code: 'RATE_LIMITED' })
    expect(provider).toHaveBeenCalledTimes(1)
    expect(await testDb.rateLimitBucket.findFirst({ where: { key: `ai-jd:user:${f.userId}` } })).toMatchObject({ count: 2 })
  })
})

describe('M9-T02 delayed result authorization', () => {
  it.each(['removed', 'removed-readded', 'suspended', 'company-inactive', 'gate-off', 'epoch-rotated', 'privacy-regrant'] as const)(
    'does not return a result after %s during provider I/O', async condition => {
      const f = await fixture()
      let release: ((value: JdProviderResult) => void) | undefined
      let entered!: () => void
      const reached = new Promise<void>(resolve => { entered = resolve })
      provider.mockImplementationOnce(() => { entered(); return new Promise(resolve => { release = resolve }) })
      const running = generateJobDescription(f.ctx, INPUT)
      const observed = running.then(value => ({ value, error: null }), error => ({ value: null, error }))
      try {
        await bounded(reached)
        if (condition === 'removed' || condition === 'removed-readded') {
          await testDb.companyMember.delete({ where: { userId: f.userId } })
          if (condition === 'removed-readded') await testDb.companyMember.create({ data: { companyId: f.companyId, userId: f.userId, role: 'OWNER' } })
        }
        if (condition === 'suspended') await testDb.user.update({ where: { id: f.userId }, data: { status: 'SUSPENDED' } })
        if (condition === 'company-inactive') await testDb.company.update({ where: { id: f.companyId }, data: { isActive: false } })
        if (condition === 'gate-off') await setting('ai.jdAssistant', { ...f.gate, enabled: false, epoch: randomUUID() })
        if (condition === 'epoch-rotated') await setting('ai.jdAssistant', { ...f.gate, epoch: randomUUID() })
        if (condition === 'privacy-regrant') {
          const prior = await testDb.consent.findFirstOrThrow({ where: { userId: f.userId, type: 'PRIVACY' } })
          await testDb.consent.createMany({ data: [
            { userId: f.userId, type: 'PRIVACY', granted: false, version: VERSION, createdAt: new Date(prior.createdAt.getTime() + 1) },
            { userId: f.userId, type: 'PRIVACY', granted: true, version: VERSION, createdAt: new Date(prior.createdAt.getTime() + 2) },
          ] })
        }
      } finally {
        release?.({ ok: true, output: OUTPUT })
        await bounded(observed)
      }
      const result = await observed
      expect(result.value).toBeNull()
      expect(result.error).toMatchObject({ code: condition.startsWith('gate') || condition === 'epoch-rotated' ? 'FEATURE_DISABLED' : 'FORBIDDEN' })
      expect(await testDb.auditLog.count({ where: { action: 'ai.jd.generate', actorId: f.userId } })).toBe(0)
    },
  )
})

describe('M9-T02 provider boundary and no job writes', () => {
  it('sends only sanitized title/points and returns safe two-field output without saving a job', async () => {
    const f = await fixture()
    await createJob(testDb, f.companyId, f.userId, { status: 'DRAFT' })
    const before = await testDb.job.findMany({ orderBy: { id: 'asc' } })
    const beforeConsent = await testDb.consent.findMany({ orderBy: { id: 'asc' } })
    const beforeLedger = await testDb.creditLedger.count()
    const beforeNotifications = await testDb.notification.count()
    provider.mockResolvedValue({ ok: true, output: {
      zh: '协助开发。联系 alice@example.com', en: 'Build features. Visit https://example.com/private', hidden: 'PRIVATE_OUTPUT_SENTINEL',
    } })
    const result = await generateJobDescription(f.ctx, {
      ...INPUT, title: 'Developer alice@example.com', points: 'Build features https://example.com/private',
    })
    const [content, options] = provider.mock.calls[0]!
    expect(Object.keys(content).sort()).toEqual(['points', 'title'])
    expect(content).toEqual({ title: 'Developer [已隐藏]', points: 'Build features [已隐藏]' })
    expect(Object.keys(options).sort()).toEqual(['model', 'promptVersion', 'schemaVersion', 'signal'])
    expect(options).toMatchObject({ model: 'synthetic-jd-model', promptVersion: 'jd-assistant-v1', schemaVersion: 1 })
    expect(options.signal).toBeInstanceOf(AbortSignal)
    expect(Object.keys(result).sort()).toEqual(['en', 'zh'])
    expect(JSON.stringify(result)).not.toMatch(/alice@example|example.com|PRIVATE_OUTPUT_SENTINEL/)
    expect(await testDb.job.findMany({ orderBy: { id: 'asc' } })).toEqual(before)
    expect(await testDb.consent.findMany({ orderBy: { id: 'asc' } })).toEqual(beforeConsent)
    expect(await testDb.creditLedger.count()).toBe(beforeLedger)
    expect(await testDb.notification.count()).toBe(beforeNotifications)
    const audit = await testDb.auditLog.findFirstOrThrow({ where: { action: 'ai.jd.generate', actorId: f.userId } })
    expect(audit.metadata).toEqual({ companyId: f.companyId, outcome: 'success', schemaVersion: 1, promptVersion: 'jd-assistant-v1' })
    expect(JSON.stringify(audit)).not.toMatch(/Developer|Build features|协助开发|alice@example|PRIVATE_OUTPUT_SENTINEL/)
  })

  it.each(['refusal', 'truncated', 'invalid', 'timeout', 'rate_limited', 'unavailable', 'configuration', 'aborted'] as const)(
    'maps %s to a fixed safe service error', async reason => {
      const f = await fixture()
      provider.mockResolvedValue({ ok: false, reason })
      const code = ['refusal', 'truncated', 'invalid'].includes(reason) ? 'AI_OUTPUT_INVALID'
        : ['timeout', 'aborted'].includes(reason) ? 'AI_TIMEOUT' : 'AI_UNAVAILABLE'
      await expect(generateJobDescription(f.ctx, INPUT)).rejects.toMatchObject({ code })
      expect(provider).toHaveBeenCalledTimes(1)
    },
  )

  it.each([
    { zh: '', en: 'Valid English' }, { zh: '中文', en: ' ' }, { zh: 'x'.repeat(4001), en: 'Valid English' },
    { zh: '中文' }, { zh: 'alice@example.com', en: 'Valid English' },
  ])('rejects unusable or oversized output %#', async output => {
    const f = await fixture()
    provider.mockResolvedValue({ ok: true, output })
    await expect(generateJobDescription(f.ctx, INPUT)).rejects.toMatchObject({ code: 'AI_OUTPUT_INVALID' })
  })

  it('suppresses unexpected provider exception text in errors, logs and audit', async () => {
    const f = await fixture()
    const sentinel = 'PRIVATE_PROVIDER_ERROR_SENTINEL'
    provider.mockRejectedValue(new Error(sentinel))
    const error = await generateJobDescription(f.ctx, INPUT).then(() => null, value => value)
    expect(error).toMatchObject({ code: 'AI_UNAVAILABLE' })
    expect(String(error)).not.toContain(sentinel)
    const logged = [logger.error, logger.warn, logger.info, logger.debug].map(fn => vi.mocked(fn).mock.calls)
    expect(JSON.stringify(logged)).not.toContain(sentinel)
    expect(JSON.stringify(await testDb.auditLog.findMany({ where: { action: 'ai.jd.generate' } }))).not.toContain(sentinel)
  })
})
