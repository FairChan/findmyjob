import * as Sentry from '@sentry/node'
import { Prisma } from '@prisma/client'
import type { PgBoss } from 'pg-boss'
import type { Job } from 'pg-boss'
import { db } from '../db'
import { logger } from '../lib/logger'
import { runPurgeUnverified } from './purge-unverified'
import { runRequalifyReferrals } from './requalify-referrals'
import { runPilotMonthlyCredits } from './pilot-monthly-credits'
import { runReconcileWallets } from './reconcile-wallets'
import { runExpireInvitations } from './expire-invitations'
import { runEmployerDailyDigest } from './employer-daily-digest'
import { runExportUserData } from './export-user-data'
import { runPurgeDeletedAccounts } from './purge-deleted-accounts'
import { pingHealthcheck } from '../lib/healthchecks'

export async function registerJobs(boss: PgBoss): Promise<void> {
  // ── example ──────────────────────────────────────────────────────────────
  await boss.createQueue('example')
  await boss.work('example', async (jobs: Job[]) => {
    try {
      for (const job of jobs) {
        logger.info({ jobId: job.id, name: job.name }, 'example job executed')
      }
      pingHealthcheck('example')
    } catch (err) {
      Sentry.captureException(err)
      throw err
    }
  })

  // ── prune-rate-limit ──────────────────────────────────────────────────────
  // Deletes expired RateLimitBucket rows (windowEnd < now()); runs hourly.
  await boss.createQueue('prune-rate-limit')
  await boss.schedule('prune-rate-limit', '0 * * * *', {})
  await boss.work('prune-rate-limit', async () => {
    try {
      const result = await db.$executeRaw(
        Prisma.sql`DELETE FROM "RateLimitBucket" WHERE "windowEnd" < now()`,
      )
      logger.info({ deleted: result }, 'prune-rate-limit completed')
      pingHealthcheck('prune-rate-limit')
    } catch (err) {
      Sentry.captureException(err)
      throw err
    }
  })

  await boss.createQueue('purge-unverified')
  // Run every hour to remove student accounts that have not verified their email
  // within signup.unverifiedTtlHours (default 48h)
  await boss.schedule('purge-unverified', '0 * * * *', {})
  await boss.work('purge-unverified', async () => {
    await runPurgeUnverified()
  })

  // ── requalify-referrals ───────────────────────────────────────────────────
  // Re-evaluates PENDING referrals daily at 00:15 Asia/Kuala_Lumpur (16:15 UTC).
  await boss.createQueue('requalify-referrals')
  await boss.schedule('requalify-referrals', '15 16 * * *', {})
  await boss.work('requalify-referrals', async () => {
    try {
      await runRequalifyReferrals()
      pingHealthcheck('requalify-referrals')
    } catch (err) {
      Sentry.captureException(err)
      throw err
    }
  })

  // ── pilot-monthly-credits ─────────────────────────────────────────────────
  // Top up all verified company wallets on the 1st of each month at 00:10 KL time.
  // Skipped when billing.enabled=true. missed:'once' catches up after downtime.
  await boss.createQueue('pilot-monthly-credits')
  await boss.schedule('pilot-monthly-credits', '10 0 1 * *', {}, { tz: 'Asia/Kuala_Lumpur', missed: 'once' })
  await boss.work('pilot-monthly-credits', async () => {
    try {
      await runPilotMonthlyCredits()
      pingHealthcheck('pilot-monthly-credits')
    } catch (err) {
      Sentry.captureException(err)
      throw err
    }
  })

  // ── reconcile-wallets ──────────────────────────────────────────────────────
  // Daily at 03:00 Asia/Kuala_Lumpur. missed:'once' catches up after downtime.
  await boss.createQueue('reconcile-wallets')
  await boss.schedule('reconcile-wallets', '0 3 * * *', {}, { tz: 'Asia/Kuala_Lumpur', missed: 'once' })
  await boss.work('reconcile-wallets', async () => {
    try {
      await runReconcileWallets()
      pingHealthcheck('reconcile-wallets')
    } catch (err) {
      Sentry.captureException(err)
      throw err
    }
  })

  // ── expire-invitations ────────────────────────────────────────────────────
  // Marks SENT invitations past their expiresAt as EXPIRED.
  // Runs every 15 minutes to stay reasonably up-to-date.
  await boss.createQueue('expire-invitations')
  await boss.schedule('expire-invitations', '*/15 * * * *', {})
  await boss.work('expire-invitations', async () => {
    try {
      await runExpireInvitations()
      pingHealthcheck('expire-invitations')
    } catch (err) {
      Sentry.captureException(err)
      throw err
    }
  })

  // ── employer-daily-digest ─────────────────────────────────────────────────
  // Send a digest of yesterday's applications to company owners at 08:00 KL time.
  // missed:'once' catches up after downtime.
  await boss.createQueue('employer-daily-digest')
  await boss.schedule('employer-daily-digest', '0 8 * * *', {}, { tz: 'Asia/Kuala_Lumpur', missed: 'once' })
  await boss.work('employer-daily-digest', async () => {
    try {
      await runEmployerDailyDigest()
      pingHealthcheck('employer-daily-digest')
    } catch (err) {
      Sentry.captureException(err)
      throw err
    }
  })

  // ── export-user-data ──────────────────────────────────────────────────────
  await boss.createQueue('export-user-data')
  await boss.work('export-user-data', async (jobs) => {
    for (const job of jobs) {
      try {
        await runExportUserData(job.data as { requestId: string; userId: string })
      } catch (err) {
        Sentry.captureException(err)
        throw err
      }
    }
  })

  // ── purge-deleted-accounts ─────────────────────────────────────────────────
  // Runs daily at 03:30 KL time to purge accounts deleted > 30 days ago.
  await boss.createQueue('purge-deleted-accounts')
  await boss.schedule('purge-deleted-accounts', '30 3 * * *', {}, { tz: 'Asia/Kuala_Lumpur', missed: 'once' })
  await boss.work('purge-deleted-accounts', async () => {
    try {
      const { purged } = await runPurgeDeletedAccounts()
      logger.info({ purged }, 'purge-deleted-accounts completed')
      pingHealthcheck('purge-deleted-accounts')
    } catch (err) {
      Sentry.captureException(err)
      throw err
    }
  })

  logger.info('jobs registered')
}
