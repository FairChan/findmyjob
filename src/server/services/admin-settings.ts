import 'server-only'
import { z } from 'zod'
import { DEFAULT_PUBLIC_SHOWCASE, PUBLIC_SHOWCASE_KEY, publicShowcaseSchema } from '@/schemas/public-showcase'
import { randomUUID } from 'node:crypto'
import { matchingGateInputSchema } from '@/schemas/semantic-matching'
import { env } from '@/env'
import { marketingGateInputSchema } from '@/schemas/marketing-settings'
import { marketingUnsubscribeConfigured } from '../lib/marketing-unsubscribe'
import { isMarketingDisclosurePublished } from '../lib/marketing-disclosure'
import { resumeParseGateSchema } from '../schemas/resume-parsing'
import { db } from '../db'
import { VersionMismatchError, ForbiddenError, NotFoundError, ValidationError } from '../errors'
import { getSetting, setSetting } from './settings'
import type { UserCtx } from '../authz'
import { bankTransferSettingsSchema, EMPTY_BANK_TRANSFER, foundingOfferSettingsSchema, DEFAULT_FOUNDING_OFFER } from '../lib/billing-settings'
import { invoiceIssuerSettingsSchema, EMPTY_INVOICE_ISSUER } from '../lib/invoice-settings'

async function assertAdmin(userId: string): Promise<void> {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { role: true, status: true },
  })
  if (!user || user.role !== 'ADMIN' || user.status !== 'ACTIVE') {
    throw new ForbiddenError()
  }
}

export interface SettingMeta {
  key: string
  defaultValue: unknown
  schema: z.ZodType<unknown>
  group: string
  p1?: boolean
}

export const SETTINGS: SettingMeta[] = [
  { key: PUBLIC_SHOWCASE_KEY, defaultValue: DEFAULT_PUBLIC_SHOWCASE, schema: publicShowcaseSchema, group: 'showcase' },
  { key: 'billing.enabled', defaultValue: false, schema: z.boolean(), group: 'billing' },
  { key: 'billing.studentEnabled', defaultValue: false, schema: z.boolean(), group: 'billing' },
  { key: 'billing.bankTransfer', defaultValue: EMPTY_BANK_TRANSFER, schema: bankTransferSettingsSchema, group: 'billing' },
  { key: 'billing.invoiceIssuer', defaultValue: EMPTY_INVOICE_ISSUER, schema: invoiceIssuerSettingsSchema, group: 'billing' },
  { key: 'billing.foundingOffer', defaultValue: DEFAULT_FOUNDING_OFFER, schema: foundingOfferSettingsSchema, group: 'billing' },
  { key: 'pilot.monthlyCredits', defaultValue: 30, schema: z.number().int().min(0).max(10000), group: 'pilot' },
  { key: 'unlock.costCredits', defaultValue: 1, schema: z.number().int().min(0).max(1000), group: 'unlock' },
  { key: 'unlock.enabled', defaultValue: true, schema: z.boolean(), group: 'unlock', p1: true },
  { key: 'limits.profileViewsPerDay', defaultValue: 200, schema: z.number().int().min(1).max(100000), group: 'limits' },
  { key: 'limits.companyProfileViewsPerDay', defaultValue: 400, schema: z.number().int().min(1).max(100000), group: 'limits' },
  { key: 'limits.searchPagesPerDay', defaultValue: 300, schema: z.number().int().min(1).max(100000), group: 'limits' },
  { key: 'limits.unlocksPerDay', defaultValue: 50, schema: z.number().int().min(1).max(100000), group: 'limits' },
  { key: 'limits.otpSendsPerHour', defaultValue: 5, schema: z.number().int().min(1).max(100), group: 'limits' },
  { key: 'limits.otpSendsPerEmailPerDay', defaultValue: 5, schema: z.number().int().min(1).max(100), group: 'limits' },
  { key: 'limits.uploadsPerHour', defaultValue: 20, schema: z.number().int().min(1).max(1000), group: 'limits' },
  { key: 'limits.jobReportsPerDay', defaultValue: 10, schema: z.number().int().min(1).max(1000), group: 'limits' },
  { key: 'limits.aiJdPerUserPerHour', defaultValue: 10, schema: z.number().int().min(1).max(1000), group: 'limits' },
  { key: 'limits.aiJdPerCompanyPerHour', defaultValue: 30, schema: z.number().int().min(1).max(1000), group: 'limits' },
  { key: 'ai.matching.reconcileBatchSize', defaultValue: 25, schema: z.number().int().min(1).max(50), group: 'ai' },
  { key: 'ai.matching.reconcileEveryMinutes', defaultValue: 5, schema: z.number().int().min(1).max(30), group: 'ai' },
  { key: 'talentSearch.maxPage', defaultValue: 25, schema: z.number().int().min(1).max(1000), group: 'talentSearch' },
  { key: 'talentPool.minCompleteness', defaultValue: 60, schema: z.number().int().min(0).max(100), group: 'talentPool' },
  { key: 'talentPool.searchEnabled', defaultValue: true, schema: z.boolean(), group: 'talentPool', p1: true },
  { key: 'team.maxMembers', defaultValue: 3, schema: z.number().int().min(1).max(100), group: 'team' },
  { key: 'jobs.autoPublishAfter', defaultValue: 1000, schema: z.number().int().min(0).max(1000000), group: 'jobs' },
  {
    key: 'jobs.salaryBands',
    defaultValue: [2000, 3000, 5000, 8000],
    schema: z.array(z.number().int().min(0)).min(1).max(20),
    group: 'jobs',
  },
  { key: 'invitations.expireDays', defaultValue: 14, schema: z.number().int().min(1).max(365), group: 'invitations' },
  { key: 'invitations.freeMonthlyQuota', defaultValue: 20, schema: z.number().int().min(0).max(10000), group: 'invitations' },
  { key: 'studentQuota.enabled', defaultValue: true, schema: z.boolean(), group: 'studentQuota' },
  { key: 'studentQuota.baseJobViews', defaultValue: 20, schema: z.number().int().min(0).max(10000), group: 'studentQuota' },
  { key: 'studentQuota.tierSize', defaultValue: 3, schema: z.number().int().min(1).max(100), group: 'studentQuota' },
  { key: 'studentQuota.tierBonus', defaultValue: 10, schema: z.number().int().min(1).max(1000), group: 'studentQuota' },
  { key: 'studentQuota.unlimitedAt', defaultValue: 12, schema: z.number().int().min(1).max(1000), group: 'studentQuota' },
  { key: 'referral.minCompleteness', defaultValue: 90, schema: z.number().int().min(0).max(100), group: 'referral' },
  { key: 'referral.requireSchoolVerified', defaultValue: false, schema: z.boolean(), group: 'referral' },
  { key: 'referral.maxQualifiedPerDay', defaultValue: 3, schema: z.number().int().min(1).max(100), group: 'referral' },
  { key: 'apply.minCompleteness', defaultValue: 60, schema: z.number().int().min(0).max(100), group: 'apply' },
  { key: 'signup.studentCap', defaultValue: 3000, schema: z.number().int().min(0).max(1000000), group: 'signup' },
  { key: 'signup.warnRatio', defaultValue: 0.9, schema: z.number().min(0).max(1), group: 'signup' },
  { key: 'signup.unverifiedTtlHours', defaultValue: 48, schema: z.number().int().min(1).max(720), group: 'signup' },
  { key: 'search.defaultMode', defaultValue: 'EXACT', schema: z.enum(['EXACT', 'RELATED']), group: 'search' },
  { key: 'search.relatedFallbackBelow', defaultValue: 5, schema: z.number().int().min(0).max(100), group: 'search' },
  { key: 'resume.maxPages', defaultValue: 20, schema: z.number().int().min(1).max(100), group: 'resume' },
  { key: 'legal.currentVersion', defaultValue: '2026-11-draft', schema: z.string().min(1).max(100), group: 'legal' },
  { key: 'uploads.enabled', defaultValue: true, schema: z.boolean(), group: 'uploads', p1: true },
]

const SETTINGS_BY_KEY = new Map<string, SettingMeta>(SETTINGS.map((s) => [s.key, s]))

export interface SettingEntry extends SettingMeta {
  currentValue: unknown
}

/** Serializable subset safe to pass to Client Components (no Zod schema). */
export interface SettingDisplay {
  key: string
  defaultValue: unknown
  group: string
  p1?: boolean
  currentValue: unknown
}

export async function getAllSettings(ctx: UserCtx): Promise<SettingDisplay[]> {
  await assertAdmin(ctx.userId)
  const rows = await db.systemSetting.findMany()
  const dbMap = new Map(rows.map((r) => [r.key, r.value]))
  return SETTINGS.map((s) => ({
    key: s.key,
    defaultValue: s.defaultValue,
    group: s.group,
    p1: s.p1,
    currentValue: dbMap.has(s.key) ? dbMap.get(s.key) : s.defaultValue,
  }))
}

export async function updateSettingAdmin(
  ctx: UserCtx,
  key: string,
  rawValue: unknown,
): Promise<void> {
  await assertAdmin(ctx.userId)
  if (key === PUBLIC_SHOWCASE_KEY) throw new NotFoundError('Dedicated showcase settings writer required')
  if (key === 'marketing.weekly') throw new NotFoundError('Dedicated marketing settings writer required')
  if (key === 'ai.matching') throw new NotFoundError('Dedicated matching settings writer required')
  const meta = SETTINGS_BY_KEY.get(key)
  if (!meta) throw new NotFoundError(`Unknown setting key: ${key}`)
  const parsed = meta.schema.safeParse(rawValue)
  if (!parsed.success) {
    const msg = parsed.error.issues[0]?.message ?? parsed.error.message ?? 'Invalid value'
    throw new ValidationError(msg)
  }
  await setSetting(key, parsed.data, ctx.userId)
}

export { getSetting }

export async function updatePublicShowcaseSettingsAdmin(ctx: UserCtx, rawValue: unknown): Promise<void> {
  await assertAdmin(ctx.userId)
  const parsed = publicShowcaseSchema.safeParse(rawValue)
  if (!parsed.success) throw new ValidationError('Invalid showcase configuration')
  await setSetting(PUBLIC_SHOWCASE_KEY, parsed.data, ctx.userId)
}

const jdAssistantGateInputSchema = resumeParseGateSchema.omit({ epoch: true }).strict()

export async function updateJdAssistantSettingsAdmin(ctx: UserCtx, rawValue: unknown): Promise<void> {
  await assertAdmin(ctx.userId)
  const parsed = jdAssistantGateInputSchema.safeParse(rawValue)
  if (!parsed.success) throw new ValidationError('Invalid JD assistant configuration')
  if (parsed.data.enabled) {
    const version = await getSetting<unknown>('legal.currentVersion', '2026-11-draft', { fresh: true })
    if (!parsed.data.legalVersion || typeof version !== 'string' || parsed.data.legalVersion !== version) {
      throw new VersionMismatchError()
    }
  }
  await setSetting('ai.jdAssistant', { ...parsed.data, epoch: randomUUID() }, ctx.userId)
}

const resumeParseGateInputSchema = resumeParseGateSchema.omit({ epoch: true }).strict()

export async function updateResumeParseSettingsAdmin(ctx: UserCtx, rawValue: unknown): Promise<void> {
  await assertAdmin(ctx.userId)
  const parsed = resumeParseGateInputSchema.safeParse(rawValue)
  if (!parsed.success) throw new ValidationError('Invalid resume parsing configuration')
  if (parsed.data.enabled) {
    const version = await getSetting<unknown>('legal.currentVersion', '2026-11-draft', { fresh: true })
    if (!parsed.data.legalVersion || typeof version !== 'string' || parsed.data.legalVersion !== version) {
      throw new VersionMismatchError()
    }
  }
  await setSetting('ai.resumeParse', { ...parsed.data, epoch: randomUUID() }, ctx.userId)
}

export async function updateMatchingSettingsAdmin(ctx: UserCtx, rawValue: unknown): Promise<void> {
  await assertAdmin(ctx.userId)
  const parsed = matchingGateInputSchema.safeParse(rawValue)
  if (!parsed.success) throw new ValidationError('Invalid matching configuration')
  if (parsed.data.enabled) {
    const version = await getSetting<unknown>('legal.currentVersion', '2026-11-draft', { fresh: true })
    if (!parsed.data.legalVersion || typeof version !== 'string' || parsed.data.legalVersion !== version) throw new VersionMismatchError()
    const model = z.string().trim().min(1).max(200).refine(value => !/[\u0000-\u001f\u007f]/u.test(value)).safeParse(env.AI_MODEL_EMBED)
    if (!env.VOYAGE_API_KEY?.trim() || !model.success) throw new ValidationError('Matching provider configuration unavailable')
  }
  await setSetting('ai.matching', { ...parsed.data, epoch: randomUUID() }, ctx.userId)
}

export async function updateMarketingSettingsAdmin(ctx: UserCtx, rawValue: unknown): Promise<void> {
  await assertAdmin(ctx.userId)
  const parsed = marketingGateInputSchema.safeParse(rawValue)
  if (!parsed.success) throw new ValidationError('Invalid marketing configuration')
  if (parsed.data.enabled) {
    const current = await getSetting<unknown>('legal.currentVersion', null, { fresh: true })
    if (!parsed.data.legalVersion || typeof current !== 'string' || parsed.data.legalVersion !== current) throw new VersionMismatchError()
    if (!marketingUnsubscribeConfigured() || !await isMarketingDisclosurePublished(current)) throw new ValidationError('Marketing publication or signing configuration unavailable')
  }
  await setSetting('marketing.weekly', { ...parsed.data, epoch: randomUUID() }, ctx.userId)
}
