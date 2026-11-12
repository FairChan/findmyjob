import 'server-only'
import { db } from '../db'
import { ForbiddenError } from '../errors'
import { getSetting } from './settings'
import { getCreditTotals } from './credits'
import type { UserCtx } from '../authz'

async function assertAdmin(userId: string): Promise<void> {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { role: true, status: true },
  })
  if (!user || user.role !== 'ADMIN' || user.status !== 'ACTIVE') {
    throw new ForbiddenError()
  }
}

type WeekBucket = { week_start: Date; cnt: bigint }
type ActivityWeekBucket = { week_start: Date; applications: bigint; unlocks: bigint; published_jobs: bigint }
type SchoolBucket = { nameZh: string; nameEn: string; cnt: bigint }

export interface DashboardStats {
  /** Active, verified students (signup-cap 口径) */
  studentCount: number
  /** Students with completeness >= 60 */
  completenessGe60: number
  /** Companies with verificationStatus = VERIFIED */
  verifiedCompanyCount: number
  /** Jobs with status = PUBLISHED */
  publishedJobCount: number
  /** Jobs with status = PENDING_REVIEW */
  pendingJobCount: number
  /** Companies with verificationStatus = PENDING */
  pendingCompanyCount: number
  /** Total applications */
  applicationCount: number
  /** Total unlocks */
  unlockCount: number
  /** Sum of positive credit ledger deltas */
  creditsGranted: number
  /** Sum of absolute values of negative credit ledger deltas */
  creditsConsumed: number
  /** signup.studentCap setting value */
  signupCap: number
  /** Last 12 natural weeks in KL timezone (Monday-based), oldest first */
  weeklyRegistrations: Array<{ label: string; value: number }>
  weeklyApplications: Array<{ label: string; value: number }>
  weeklyUnlocks: Array<{ label: string; value: number }>
  /** Publication history by publishedAt, including jobs subsequently closed. */
  weeklyPublishedJobs: Array<{ label: string; value: number }>
  /** Students per school (top 10, by count desc) */
  schoolDistribution: Array<{ schoolNameZh: string; schoolNameEn: string; count: number }>
}

export async function getDashboardStats(ctx: UserCtx): Promise<DashboardStats> {
  await assertAdmin(ctx.userId)

  const [
    studentCount,
    completenessGe60,
    verifiedCompanyCount,
    publishedJobCount,
    pendingJobCount,
    pendingCompanyCount,
    applicationCount,
    unlockCount,
    creditTotals,
    signupCap,
    weeklyRaw,
    activityWeeklyRaw,
    schoolRaw,
  ] = await Promise.all([
    db.user.count({
      where: { role: 'STUDENT', status: 'ACTIVE', emailVerified: true },
    }),
    db.studentProfile.count({
      where: { completeness: { gte: 60 } },
    }),
    db.company.count({
      where: { verificationStatus: 'VERIFIED' },
    }),
    db.job.count({ where: { status: 'PUBLISHED' } }),
    db.job.count({ where: { status: 'PENDING_REVIEW' } }),
    db.company.count({ where: { verificationStatus: 'PENDING' } }),
    db.application.count(),
    db.talentUnlock.count(),
    getCreditTotals(),
    getSetting<number>('signup.studentCap', 3000),
    // Weekly new student registrations: last 12 natural weeks in KL timezone (week = Monday)
    db.$queryRaw<WeekBucket[]>`
      WITH weeks AS (
        SELECT generate_series(
          date_trunc('week', (NOW() AT TIME ZONE 'Asia/Kuala_Lumpur') - INTERVAL '11 weeks'),
          date_trunc('week', NOW() AT TIME ZONE 'Asia/Kuala_Lumpur'),
          INTERVAL '1 week'
        ) AS week_start
      )
      SELECT
        w.week_start,
        COALESCE(COUNT(sp.id), 0) AS cnt
      FROM weeks w
      LEFT JOIN "StudentProfile" sp ON
        date_trunc('week', sp."createdAt" AT TIME ZONE 'Asia/Kuala_Lumpur') = w.week_start
      GROUP BY w.week_start
      ORDER BY w.week_start
    `,
    // Aggregate all activity in one snapshot; publishedAt distinguishes publication from drafting.
    db.$queryRaw<ActivityWeekBucket[]>`
      WITH weeks AS (
        SELECT generate_series(
          date_trunc('week', (NOW() AT TIME ZONE 'Asia/Kuala_Lumpur') - INTERVAL '11 weeks'),
          date_trunc('week', NOW() AT TIME ZONE 'Asia/Kuala_Lumpur'),
          INTERVAL '1 week'
        ) AS week_start
      ), activity AS (
        SELECT "createdAt" AS occurred_at, 'application' AS kind FROM "Application"
        UNION ALL
        SELECT "createdAt", 'unlock' FROM "TalentUnlock"
        UNION ALL
        SELECT "publishedAt", 'publication' FROM "Job" WHERE "publishedAt" IS NOT NULL
      )
      SELECT w.week_start,
        COUNT(*) FILTER (WHERE a.kind = 'application') AS applications,
        COUNT(*) FILTER (WHERE a.kind = 'unlock') AS unlocks,
        COUNT(*) FILTER (WHERE a.kind = 'publication') AS published_jobs
      FROM weeks w
      LEFT JOIN activity a ON
        a.occurred_at >= w.week_start AT TIME ZONE 'Asia/Kuala_Lumpur'
        AND a.occurred_at < (w.week_start + INTERVAL '1 week') AT TIME ZONE 'Asia/Kuala_Lumpur'
      GROUP BY w.week_start
      ORDER BY w.week_start
    `,
    // Student count per school (active schools only, top 10)
    db.$queryRaw<SchoolBucket[]>`
      SELECT
        s."nameZh",
        s."nameEn",
        COUNT(sp.id) AS cnt
      FROM "School" s
      LEFT JOIN "StudentProfile" sp ON sp."schoolId" = s.id
      WHERE s.active = true
      GROUP BY s.id, s."nameZh", s."nameEn"
      ORDER BY cnt DESC, s."nameZh"
      LIMIT 10
    `,
  ])

  const weeklyRegistrations = weeklyRaw.map((row) => ({
    label: formatWeekLabel(row.week_start),
    value: Number(row.cnt),
  }))

  const schoolDistribution = schoolRaw.map((row) => ({
    schoolNameZh: row.nameZh,
    schoolNameEn: row.nameEn,
    count: Number(row.cnt),
  }))

  return {
    studentCount,
    completenessGe60,
    verifiedCompanyCount,
    publishedJobCount,
    pendingJobCount,
    pendingCompanyCount,
    applicationCount,
    unlockCount,
    creditsGranted: creditTotals.granted,
    creditsConsumed: creditTotals.consumed,
    signupCap,
    weeklyRegistrations,
    weeklyApplications: activityWeeklyRaw.map((row) => ({ label: formatWeekLabel(row.week_start), value: Number(row.applications) })),
    weeklyUnlocks: activityWeeklyRaw.map((row) => ({ label: formatWeekLabel(row.week_start), value: Number(row.unlocks) })),
    weeklyPublishedJobs: activityWeeklyRaw.map((row) => ({ label: formatWeekLabel(row.week_start), value: Number(row.published_jobs) })),
    schoolDistribution,
  }
}

/** Format a week_start Date (Postgres timestamp-without-tz returned as UTC-interpreted) */
function formatWeekLabel(weekStart: Date): string {
  const month = String(weekStart.getUTCMonth() + 1).padStart(2, '0')
  const day = String(weekStart.getUTCDate()).padStart(2, '0')
  return `${month}/${day}`
}
