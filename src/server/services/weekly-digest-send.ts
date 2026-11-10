import 'server-only'
import { Prisma } from '@prisma/client'
import { db } from '../db'
import { createEmailProvider, EmailDeliveryError } from '@/lib/email'
import { checkEmailCap } from '../lib/email-cap'
import { lockXact, LOCK_NS } from '../lib/advisory-locks'
import { createMarketingUnsubscribeToken } from '../lib/marketing-unsubscribe'
import { renderEmailTemplate } from '../email/templates'
import type { WeeklyJobRow, WeeklyTalentRow } from '../email/templates/weekly'
import { contextMatches, loadWeeklyContextTx, reloadWeeklyRowsTx } from './weekly-digest-data'

export type WeeklySendResult = { status: 'accepted' } | { status: 'retryable'; reason: 'cap' | 'not-accepted' } | { status: 'suppressed' } | { status: 'unknown' }
export async function sendWeeklyDigestEmail(input: { deliveryId: string; leaseToken: string }): Promise<WeeklySendResult> {
  const initial = await db.weeklyDigestDelivery.findUnique({ where: { id: input.deliveryId } })
  if (!initial || initial.state !== 'PREPARING' || initial.leaseToken !== input.leaseToken || !initial.leaseExpiresAt || initial.leaseExpiresAt <= new Date()) return { status: 'suppressed' }
  const template = initial.kind === 'STUDENT_JOBS' ? 'weekly-jobs' : 'weekly-talents'
  if (!await checkEmailCap({ template })) return { status: 'retryable', reason: 'cap' }
  const prepared = await db.$transaction(async tx => {
    // Follow the existing T03 source locks in a deterministic order. These are
    // held only for final preparation, never across cap/provider network work.
    const ids = Array.isArray(initial.candidateIds) && initial.candidateIds.length <= 5
      ? initial.candidateIds.filter((id): id is string => typeof id === 'string') : []
    const jobIds = initial.kind === 'STUDENT_JOBS' ? ids : [initial.sourceId]
    if (jobIds.length) await tx.$queryRaw(Prisma.sql`SELECT id FROM "Job" WHERE id IN (${Prisma.join([...jobIds].sort())}) ORDER BY id FOR SHARE`)
    const studentUsers = initial.kind === 'STUDENT_JOBS' ? [initial.userId]
      : (await tx.studentProfile.findMany({ where: { id: { in: ids } }, select: { userId: true } })).map(profile => profile.userId)
    // Recipient legal consent (including an employer's) uses this same source lock.
    for (const userId of [...new Set([...studentUsers, initial.userId])].sort()) await lockXact(tx, LOCK_NS.STUDENT_DATA, userId)
    await lockXact(tx, LOCK_NS.MARKETING, initial.userId)
    if (initial.kind === 'EMPLOYER_TALENTS') {
      // Stable order; setSetting locks before its upsert. This also protects
      // default values when a setting has no row yet, without creating rows.
      for (const key of ['talentPool.minCompleteness', 'talentPool.searchEnabled']) {
        await lockXact(tx, LOCK_NS.SYSTEM_SETTING, key)
      }
    }
    // Lock existing configuration rows before fresh reads. Controlled settings
    // upserts conflict with SHARE until SENDING commits; absent rows fail closed.
    const settings = await tx.$queryRaw<Array<{ key: string }>>(Prisma.sql`
      SELECT "key" FROM "SystemSetting"
      WHERE "key" IN ('ai.matching', 'legal.currentVersion', 'marketing.weekly')
      ORDER BY "key" ASC FOR SHARE
    `)
    if (settings.length !== 3) return null
    const row = await tx.weeklyDigestDelivery.findUnique({ where: { id: input.deliveryId } })
    const now = new Date()
    if (!row || row.state !== 'PREPARING' || row.leaseToken !== input.leaseToken || !row.leaseExpiresAt || row.leaseExpiresAt <= now || row.expiresAt <= now) return null
    const context = await loadWeeklyContextTx(tx, row, row.sourceId)
    if (!context || !contextMatches(row, context) || !Array.isArray(row.candidateIds) || row.candidateIds.length > 5 ||
      row.candidateIds.some(id => typeof id !== 'string')) return null
    const rows = await reloadWeeklyRowsTx(tx, context, row.candidateIds as string[])
    if (rows.length === 0) return null
    // Render only an explicit freshly reloaded DTO; never recommendation objects.
    const common = { locale: context.locale, unsubscribeToken: createMarketingUnsubscribeToken(row.userId) }
    const content = row.kind === 'STUDENT_JOBS'
      ? renderEmailTemplate({ ...common, template: 'weekly-jobs', rows: rows as WeeklyJobRow[] })
      : renderEmailTemplate({ ...common, template: 'weekly-talents', rows: rows as WeeklyTalentRow[] })
    const transitionNow = new Date()
    const changed = await tx.weeklyDigestDelivery.updateMany({
      where: { id: row.id, state: 'PREPARING', leaseToken: input.leaseToken, leaseExpiresAt: { gt: transitionNow }, expiresAt: { gt: transitionNow } },
      data: { state: 'SENDING', leaseExpiresAt: new Date(transitionNow.getTime() + 60_000) },
    })
    return changed.count === 1 ? { to: context.email, subject: content.subject, html: content.html, text: content.text } : null
  })
  if (!prepared) return { status: 'suppressed' }
  // Commit before HTTP. A later revocation cannot recall an in-flight email.
  const provider = createEmailProvider()
  try { await provider.sendEmail(prepared); return { status: 'accepted' } }
  catch (error) {
    return error instanceof EmailDeliveryError && error.outcome === 'not-accepted'
      ? { status: 'retryable', reason: 'not-accepted' } : { status: 'unknown' }
  } finally {
    // A deadline response is not proof the underlying provider promise settled.
    // Registry shutdown owns this tail; UNKNOWN classification never becomes a retry.
    await provider.settle?.()
  }
}
