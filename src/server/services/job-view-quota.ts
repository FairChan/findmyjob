import 'server-only'
import { db } from '../db'
import { getSetting } from './settings'
import { lockXact, LOCK_NS } from '../lib/advisory-locks'

export type QuotaResult = {
  used: number
  limit: number | null // null = unlimited
  next: number // referrals needed to reach next tier/unlimited; 0 when already unlimited
  qualified: number // current qualified referral count
}

export type OpenJobResult = {
  allowed: boolean
  isNewView: boolean
  quota: QuotaResult
}

async function readSettings() {
  const [enabled, base, tierSize, tierBonus, unlimitedAt] = await Promise.all([
    getSetting<boolean>('studentQuota.enabled', true),
    getSetting<number>('studentQuota.baseJobViews', 20),
    getSetting<number>('studentQuota.tierSize', 3),
    getSetting<number>('studentQuota.tierBonus', 10),
    getSetting<number>('studentQuota.unlimitedAt', 12),
  ])
  return { enabled, base, tierSize, tierBonus, unlimitedAt }
}

function computeQuota(
  settings: Awaited<ReturnType<typeof readSettings>>,
  used: number,
  qualified: number,
  grants: number
): QuotaResult {
  const { enabled, base, tierSize, tierBonus, unlimitedAt } = settings
  if (!enabled || qualified >= unlimitedAt) {
    return { used, limit: null, next: 0, qualified }
  }
  const limit = base + Math.floor(qualified / tierSize) * tierBonus + grants
  const next = Math.min(tierSize - (qualified % tierSize), unlimitedAt - qualified)
  return { used, limit, next, qualified }
}

/** Returns the current quota state for a student without opening any job. */
export async function getQuota(studentId: string): Promise<QuotaResult> {
  const [settings, used, qualified, grantsAgg] = await Promise.all([
    readSettings(),
    db.jobView.count({ where: { studentId } }),
    db.referral.count({ where: { referrerId: studentId, status: 'QUALIFIED' } }),
    db.jobViewGrant.aggregate({ _sum: { amount: true }, where: { studentId } }),
  ])
  const grants = grantsAgg._sum.amount ?? 0
  return computeQuota(settings, used, qualified, grants)
}

/**
 * Records that a student opened a job detail page.
 *
 * - Jobs the student has applied to or been invited to are always allowed and do not consume quota.
 * - Repeated opens of the same non-exempt job do not consume additional quota.
 * - Concurrent opens of distinct new jobs are serialised per-student via an advisory lock.
 */
export async function openJob(studentId: string, jobId: string): Promise<OpenJobResult> {
  // Exempt: student has applied or been invited to this specific job
  const [application, invitation] = await Promise.all([
    db.application.findFirst({ where: { studentId, jobId }, select: { id: true } }),
    db.invitation.findFirst({ where: { studentId, jobId }, select: { id: true } }),
  ])
  if (application || invitation) {
    const quota = await getQuota(studentId)
    return { allowed: true, isNewView: false, quota }
  }

  let allowed = false
  let isNewView = false
  let resultQuota!: QuotaResult

  await db.$transaction(async (tx) => {
    await lockXact(tx, LOCK_NS.JOB_VIEW_QUOTA, studentId)

    const [settings, used, qualified, grantsAgg] = await Promise.all([
      readSettings(),
      tx.jobView.count({ where: { studentId } }),
      tx.referral.count({ where: { referrerId: studentId, status: 'QUALIFIED' } }),
      tx.jobViewGrant.aggregate({ _sum: { amount: true }, where: { studentId } }),
    ])
    const grants = grantsAgg._sum.amount ?? 0
    const quota = computeQuota(settings, used, qualified, grants)

    // Already viewed this job — allow without counting
    const existing = await tx.jobView.findUnique({
      where: { studentId_jobId: { studentId, jobId } },
      select: { studentId: true },
    })
    if (existing) {
      allowed = true
      isNewView = false
      resultQuota = quota
      return
    }

    // Quota exhausted
    if (quota.limit !== null && used >= quota.limit) {
      allowed = false
      isNewView = false
      resultQuota = quota
      return
    }

    // Within quota — record the view
    await tx.jobView.create({ data: { studentId, jobId } })
    allowed = true
    isNewView = true
    resultQuota = { ...quota, used: used + 1 }
  })

  return { allowed, isNewView, quota: resultQuota }
}
