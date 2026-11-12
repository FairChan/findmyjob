import 'server-only'
import { Prisma } from '@prisma/client'
import { z } from 'zod'
import { env } from '@/env'
import { db } from '../db'
import type { CompanyCtx } from '../authz'
import { AppError, FeatureDisabledError, ForbiddenError, RateLimitedError, ValidationError, VersionMismatchError } from '../errors'
import { hitBucket } from '../lib/db-rate-limit'
import { generateJdSuggestion, type JdProviderResult } from '../lib/ai/jd-provider'
import { resumeParseGateSchema } from '../schemas/resume-parsing'
import {
  JD_PROMPT_VERSION, JD_SCHEMA_VERSION, normalizeJdRequest, normalizeJdSuggestion,
  type GenerateJobDescriptionInput, type JobDescriptionSuggestion,
} from '../schemas/jd-assistant'
import { logAudit } from './audit'
import { getSetting } from './settings'

const hourlyLimit = z.number().int().min(1).max(1000)
const modelSchema = z.string().trim().min(1).max(200).refine(value => !/[\u0000-\u001f\u007f]/u.test(value))
const HOUR_MS = 3_600_000
const PROVIDER_TIMEOUT_MS = 20_000
type Outcome = 'success' | 'invalid' | 'timeout' | 'unavailable'
type Authorization = {
  memberId: string; legalVersion: string; gateEpoch: string; model: string
  termsId: string; privacyId: string; userLimit: number; companyLimit: number
}

/** Short consistent snapshot only; never hold this transaction across provider/rate-limit I/O. */
async function authorizeTx(tx: Prisma.TransactionClient, ctx: CompanyCtx): Promise<Authorization> {
  if (!ctx?.userId || !ctx.companyId) throw new ForbiddenError()
  const member = await tx.companyMember.findUnique({
    where: { companyId_userId: { companyId: ctx.companyId, userId: ctx.userId } },
    select: {
      id: true, role: true,
      user: { select: { role: true, status: true } },
      company: { select: { isActive: true } },
    },
  })
  if (!member || member.user.role !== 'EMPLOYER' || member.user.status !== 'ACTIVE' || !member.company.isActive ||
    !(['OWNER', 'ADMIN', 'RECRUITER'] as const).includes(member.role)) throw new ForbiddenError()

  const [rawGate, rawVersion, rawUserLimit, rawCompanyLimit] = await Promise.all([
    getSetting<unknown>('ai.jdAssistant', null, { tx, fresh: true }),
    getSetting<unknown>('legal.currentVersion', '2026-11-draft', { tx, fresh: true }),
    getSetting<unknown>('limits.aiJdPerUserPerHour', 10, { tx, fresh: true }),
    getSetting<unknown>('limits.aiJdPerCompanyPerHour', 30, { tx, fresh: true }),
  ])
  const gate = resumeParseGateSchema.safeParse(rawGate)
  const model = modelSchema.safeParse(env.AI_MODEL_JD)
  const version = z.string().min(1).max(100).safeParse(rawVersion)
  const userLimit = hourlyLimit.safeParse(rawUserLimit)
  const companyLimit = hourlyLimit.safeParse(rawCompanyLimit)
  if (!gate.success || !gate.data.enabled || !gate.data.legalVersion || !model.success ||
    !env.ANTHROPIC_API_KEY?.trim() || !userLimit.success || !companyLimit.success) throw new FeatureDisabledError()
  if (!version.success || gate.data.legalVersion !== version.data) throw new VersionMismatchError()

  const [terms, privacy] = await Promise.all((['TERMS', 'PRIVACY'] as const).map(type => tx.consent.findFirst({
    where: { userId: ctx.userId, type },
    select: { id: true, granted: true, version: true },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
  })))
  if (!terms?.granted || !privacy?.granted) throw new ForbiddenError('Current legal consent is required')
  if (terms.version !== version.data || privacy.version !== version.data) throw new VersionMismatchError()
  return {
    memberId: member.id, legalVersion: version.data, gateEpoch: gate.data.epoch, model: model.data,
    termsId: terms.id, privacyId: privacy.id, userLimit: userLimit.data, companyLimit: companyLimit.data,
  }
}

function sameAuthorization(before: Authorization, after: Authorization): void {
  if (before.memberId !== after.memberId || before.termsId !== after.termsId || before.privacyId !== after.privacyId) {
    throw new ForbiddenError('Authorization changed')
  }
  if (before.legalVersion !== after.legalVersion) throw new VersionMismatchError()
  if (before.gateEpoch !== after.gateEpoch || before.model !== after.model) throw new FeatureDisabledError()
}

function snapshot(ctx: CompanyCtx): Promise<Authorization> {
  return db.$transaction(tx => authorizeTx(tx, ctx), { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead })
}

/** A public policy version for the server-rendered page, never credentials, epoch or company data. */
export async function getJdAssistantAvailability(ctx: CompanyCtx): Promise<{ submittedVersion: string } | null> {
  try {
    const access = await snapshot(ctx)
    return { submittedVersion: access.legalVersion }
  } catch (error) {
    if (error instanceof AppError && ['FORBIDDEN', 'FEATURE_DISABLED', 'VERSION_MISMATCH'].includes(error.code)) return null
    throw error
  }
}

function providerOutcome(result: JdProviderResult): Outcome {
  if (result.ok) return 'success'
  if (result.reason === 'refusal' || result.reason === 'truncated' || result.reason === 'invalid') return 'invalid'
  if (result.reason === 'timeout' || result.reason === 'aborted') return 'timeout'
  return 'unavailable'
}

/** Abort propagates; a late resolve/reject is observed but cannot return stale output to the caller. */
async function callProvider(
  content: { title: string; points: string }, model: string,
): Promise<JdProviderResult> {
  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  const attempt = Promise.resolve().then(() => generateJdSuggestion(content, {
    model, promptVersion: JD_PROMPT_VERSION, schemaVersion: JD_SCHEMA_VERSION, signal: controller.signal,
  })).catch((): JdProviderResult => ({ ok: false, reason: 'unavailable' }))
  try {
    return await Promise.race([
      attempt,
      new Promise<JdProviderResult>(resolve => {
        timer = setTimeout(() => {
          controller.abort()
          resolve({ ok: false, reason: 'timeout' })
        }, PROVIDER_TIMEOUT_MS)
      }),
    ])
  } finally { if (timer) clearTimeout(timer) }
}

export async function generateJobDescription(
  ctx: CompanyCtx, value: GenerateJobDescriptionInput,
): Promise<JobDescriptionSuggestion> {
  let input: ReturnType<typeof normalizeJdRequest>
  try { input = normalizeJdRequest(value) } catch { throw new ValidationError('Invalid job description request') }
  const before = await snapshot(ctx)
  if (input.submittedVersion !== before.legalVersion) throw new VersionMismatchError()

  // Existing durable fixed windows; provider failure and exhausted company capacity do not refund the user attempt.
  const userLimit = await hitBucket(`ai-jd:user:${ctx.userId}`, { windowMs: HOUR_MS, limit: before.userLimit })
  if (!userLimit.allowed) throw new RateLimitedError()
  const companyLimit = await hitBucket(`ai-jd:company:${ctx.companyId}`, { windowMs: HOUR_MS, limit: before.companyLimit })
  if (!companyLimit.allowed) throw new RateLimitedError()
  const immediatelyBefore = await snapshot(ctx)
  sameAuthorization(before, immediatelyBefore)
  if (userLimit.count > immediatelyBefore.userLimit || companyLimit.count > immediatelyBefore.companyLimit) throw new RateLimitedError()

  const generated = await callProvider({ title: input.title, points: input.points }, before.model)
  let outcome = providerOutcome(generated)
  let suggestion: JobDescriptionSuggestion | undefined
  if (generated.ok) {
    try { suggestion = normalizeJdSuggestion(generated.output) } catch { outcome = 'invalid' }
  }

  await db.$transaction(async tx => {
    const current = await authorizeTx(tx, ctx)
    sameAuthorization(before, current)
    await logAudit({
      actorId: ctx.userId, action: 'ai.jd.generate', targetType: 'Company', targetId: ctx.companyId,
      metadata: { companyId: ctx.companyId, outcome, schemaVersion: JD_SCHEMA_VERSION, promptVersion: JD_PROMPT_VERSION },
    }, tx)
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead })

  if (outcome === 'success' && suggestion) return suggestion
  if (outcome === 'invalid') throw new AppError('Generated description was invalid', 'AI_OUTPUT_INVALID', 422)
  if (outcome === 'timeout') throw new AppError('Description generation timed out', 'AI_TIMEOUT', 504)
  throw new AppError('Description generation is unavailable', 'AI_UNAVAILABLE', 503)
}
