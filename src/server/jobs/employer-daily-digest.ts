import 'server-only'
import { db } from '../db'
import { sendDailyDigestEmail } from '../services/notify'
import { logger } from '../lib/logger'
import type { DigestJobRow } from '../email/templates'

/** Returns [start, end) of the previous KL calendar day expressed as UTC dates. */
function prevKLDayRangeUtc(): { start: Date; end: Date } {
  const KL_OFFSET_MS = 8 * 60 * 60 * 1000
  const klNow = new Date(Date.now() + KL_OFFSET_MS)
  // Start of today in KL (= UTC midnight - 8h)
  const klTodayStart = new Date(
    Date.UTC(klNow.getUTCFullYear(), klNow.getUTCMonth(), klNow.getUTCDate()) - KL_OFFSET_MS,
  )
  const klYesterdayStart = new Date(klTodayStart.getTime() - 24 * 60 * 60 * 1000)
  return { start: klYesterdayStart, end: klTodayStart }
}

/**
 * Sends employer owners a digest of new applications received yesterday (KL time).
 * Skips owners whose companies had no new applications.
 */
export async function runEmployerDailyDigest(): Promise<{ sent: number; skipped: number }> {
  const { start, end } = prevKLDayRangeUtc()

  const owners = await db.companyMember.findMany({
    where: {
      role: 'OWNER',
      company: { verificationStatus: 'VERIFIED', isActive: true },
    },
    select: {
      userId: true,
      companyId: true,
      user: { select: { email: true, locale: true } },
    },
  })

  let sent = 0
  let skipped = 0

  for (const owner of owners) {
    try {
      const rows = await db.application.groupBy({
        by: ['jobId'],
        where: {
          job: { companyId: owner.companyId },
          createdAt: { gte: start, lt: end },
        },
        _count: { id: true },
      })

      if (rows.length === 0) {
        skipped++
        continue
      }

      const jobIds = rows.map((r) => r.jobId)
      const jobs = await db.job.findMany({
        where: { id: { in: jobIds } },
        select: { id: true, title: true },
      })
      const titleMap = new Map(jobs.map((j) => [j.id, j.title]))

      const digestRows: DigestJobRow[] = rows
        .map((r) => ({
          jobTitle: titleMap.get(r.jobId) ?? r.jobId,
          newApplications: r._count.id,
        }))
        .sort((a, b) => b.newApplications - a.newApplications)

      await sendDailyDigestEmail({
        to: owner.user.email,
        locale: owner.user.locale ?? 'zh',
        rows: digestRows,
      })
      sent++
    } catch (err) {
      logger.error({ err, userId: owner.userId, companyId: owner.companyId }, 'employer-daily-digest: owner failed')
    }
  }

  logger.info({ sent, skipped, date: start.toISOString() }, 'employer-daily-digest completed')
  return { sent, skipped }
}
