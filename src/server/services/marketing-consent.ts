import 'server-only'
import type { Prisma } from '@prisma/client'
import { z } from 'zod'
import { marketingConsentSchema, type MarketingConsentInput } from '@/schemas/marketing-consent'
import { db } from '../db'
import { AppError, FeatureDisabledError, ForbiddenError, ValidationError, VersionMismatchError } from '../errors'
import { lockXact, LOCK_NS } from '../lib/advisory-locks'
import { getMarketingConfiguration } from '../lib/marketing-config'
import { verifyMarketingUnsubscribeToken } from '../lib/marketing-unsubscribe'
import { getSetting } from './settings'
import { logAudit } from './audit'

export type MarketingUiState = { available: boolean; consentGranted: boolean; legalVersion: string | null }
export function latestMarketingConsentTx(tx: Prisma.TransactionClient, userId: string) {
  return tx.consent.findFirst({ where: { userId, type: 'MARKETING' }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] })
}
export async function marketingLegalGrantsTx(tx: Prisma.TransactionClient, userId: string, version: string) {
  const rows = await Promise.all((['TERMS', 'PRIVACY'] as const).map(type => tx.consent.findFirst({
    where: { userId, type }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
  })))
  if (rows.some(row => !row?.granted || row.version !== version)) return null
  return { termsId: rows[0]!.id, privacyId: rows[1]!.id }
}
async function actorTx(tx: Prisma.TransactionClient, userId: string) {
  const user = await tx.user.findUnique({ where: { id: userId }, select: { role: true, status: true } })
  if (!user || user.status !== 'ACTIVE' || !['STUDENT', 'EMPLOYER'].includes(user.role)) throw new ForbiddenError()
}
export async function getMarketingUiState(ctx: { userId: string }): Promise<MarketingUiState> {
  return db.$transaction(async tx => {
    await lockXact(tx, LOCK_NS.MARKETING, ctx.userId)
    await actorTx(tx, ctx.userId)
    const [latest, config, rawVersion] = await Promise.all([
      latestMarketingConsentTx(tx, ctx.userId), getMarketingConfiguration(tx),
      getSetting<unknown>('legal.currentVersion', null, { tx, fresh: true }),
    ])
    const version = z.string().min(1).max(100).safeParse(rawVersion)
    const currentLegal = config ? await marketingLegalGrantsTx(tx, ctx.userId, config.legalVersion) : null
    return { available: config !== null && currentLegal !== null, consentGranted: latest?.granted === true,
      legalVersion: version.success ? version.data : null }
  })
}
async function writeTx(tx: Prisma.TransactionClient, userId: string, input: MarketingConsentInput): Promise<void> {
  const latest = await latestMarketingConsentTx(tx, userId)
  const rawVersion = await getSetting<unknown>('legal.currentVersion', null, { tx, fresh: true })
  const parsedVersion = z.string().min(1).max(100).safeParse(rawVersion)
  const version = parsedVersion.success ? parsedVersion.data : latest?.version ?? 'withdrawal-v1'
  if (input.granted) {
    const config = await getMarketingConfiguration(tx)
    if (!config) throw new FeatureDisabledError()
    if (input.submittedVersion !== config.legalVersion) throw new VersionMismatchError()
    if (!await marketingLegalGrantsTx(tx, userId, config.legalVersion)) throw new ForbiddenError()
    if (latest?.granted && latest.version === config.legalVersion) return
  } else if (latest?.granted === false) return
  const [clock] = await tx.$queryRaw<Array<{ now: Date }>>`SELECT clock_timestamp() AS "now"`
  if (!clock) throw new AppError('Consent clock unavailable', 'INTERNAL_ERROR', 500)
  await tx.consent.create({ data: { userId, type: 'MARKETING', granted: input.granted, version,
    createdAt: new Date(Math.max(clock.now.getTime(), (latest?.createdAt.getTime() ?? 0) + 1)) } })
  if (!input.granted) await tx.weeklyDigestDelivery.updateMany({
    where: { userId, state: { in: ['QUEUED', 'PREPARING', 'RETRYABLE'] } },
    data: { state: 'SKIPPED', failureCode: 'AUTHORIZATION_CHANGED', nextAttemptAt: null, leaseToken: null, leaseExpiresAt: null, candidateIds: [] },
  })
  await logAudit({ actorId: userId, action: 'marketing.consent', targetType: 'User', targetId: userId,
    metadata: { granted: input.granted, version } }, tx)
}
export async function setMarketingConsent(ctx: { userId: string }, raw: MarketingConsentInput): Promise<void> {
  const input = marketingConsentSchema.safeParse(raw)
  if (!input.success) throw new ValidationError('Invalid marketing preference')
  await db.$transaction(async tx => {
    await lockXact(tx, LOCK_NS.MARKETING, ctx.userId)
    await actorTx(tx, ctx.userId)
    await writeTx(tx, ctx.userId, input.data)
  })
}
export async function unsubscribeMarketing(token: string): Promise<void> {
  const verified = verifyMarketingUnsubscribeToken(token)
  if (!verified) return
  await db.$transaction(async tx => {
    await lockXact(tx, LOCK_NS.MARKETING, verified.userId)
    // A signed withdrawal remains valid despite suspension or changed policies.
    if (!await tx.user.findUnique({ where: { id: verified.userId }, select: { id: true } })) return
    if (!(await latestMarketingConsentTx(tx, verified.userId))?.granted) return
    await writeTx(tx, verified.userId, { granted: false })
  })
}
