import * as Sentry from '@sentry/node'
import { z } from 'zod'
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
import { runExpireSubscriptions } from './expire-subscriptions'
import { runInvoiceTasks } from './invoice-tasks'
import { runEmployerDailyDigest } from './employer-daily-digest'
import { runExportUserData } from './export-user-data'
import { runPurgeDeletedAccounts } from './purge-deleted-accounts'
import { pingHealthcheck } from '../lib/healthchecks'
import { runPushDispatch } from './push-notifications'

// Retain ownership of T01 tasks through actual settlement. A pg-boss shutdown
// grace ending proves neither child close nor recovery/storage completion.
export function createJobLifecycle() {
  const controller = new AbortController()
  const active = new Set<Promise<void>>()
  let stopping: Promise<void> | undefined
  return {
    signal: controller.signal,
    async run(work: (signal: AbortSignal) => Promise<void>): Promise<void> {
      if (controller.signal.aborted) return
      const running = Promise.resolve().then(async () => {
        if (!controller.signal.aborted) await work(controller.signal)
      })
      active.add(running)
      try { await running } finally { active.delete(running) }
    },
    stop(): Promise<void> {
      // Abort synchronously before starting any asynchronous drain or boss stop.
      controller.abort()
      stopping ??= Promise.allSettled([...active]).then(() => {})
      return stopping
    },
  }
}

export async function registerJobs(boss: PgBoss, lifecycle = createJobLifecycle()): Promise<void> {
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

  // ── push-dispatch（MA3-T02）：每分钟把刚提交的学生通知推到 App；FCM 未配置时直接返回 ──
  await boss.createQueue('push-dispatch')
  await boss.schedule('push-dispatch', '* * * * *', {})
  await boss.work('push-dispatch', async () => {
    try {
      await lifecycle.run(async (signal) => {
        if (!signal.aborted) await runPushDispatch()
      })
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

  await boss.createQueue('expire-subscriptions')
  await boss.schedule('expire-subscriptions', '30 0 * * *', {}, { tz: 'Asia/Kuala_Lumpur', missed: 'once' })
  await boss.work('expire-subscriptions', async () => {
    try {
      await runExpireSubscriptions()
      pingHealthcheck('expire-subscriptions')
    } catch (err) {
      Sentry.captureException(err)
      throw err
    }
  })

  await boss.createQueue('invoice-tasks')
  await boss.schedule('invoice-tasks', '* * * * *', {}, { tz: 'Asia/Kuala_Lumpur', missed: 'once' })
  await boss.work('invoice-tasks', async () => {
    try {
      await runInvoiceTasks()
      pingHealthcheck('invoice-tasks')
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

  // ── resume-parse and durable recovery ─────────────────────────────────────
  await boss.createQueue('resume-parse')
  await boss.work<{ resumeId: string; generation: number }>('resume-parse', { localConcurrency: 1, batchSize: 1 }, async jobs => {
    for (const job of jobs) await lifecycle.run(async shutdownSignal => {
      const signal = AbortSignal.any([shutdownSignal, job.signal])
      if (signal.aborted) return
      try {
        const { runResumeParse } = await import('./parse-resume')
        if (!signal.aborted) await runResumeParse(job.data, { signal })
      } catch {
        const error = new Error('RESUME_PARSE_JOB_FAILED')
        Sentry.captureException(error)
        throw error
      }
    })
  })

  await boss.createQueue('dispatch-resume-parses')
  await boss.schedule('dispatch-resume-parses', '* * * * *', {}, { missed: 'once' })
  await boss.work('dispatch-resume-parses', { localConcurrency: 1, batchSize: 1 }, async () => lifecycle.run(async signal => {
    try {
      const { dispatchPendingResumeParses } = await import('../services/resume-parsing')
      if (signal.aborted) return
      await dispatchPendingResumeParses()
      pingHealthcheck('dispatch-resume-parses')
    } catch {
      const error = new Error('RESUME_PARSE_DISPATCH_FAILED')
      Sentry.captureException(error)
      throw error
    }
  }))

  // Independent of account purge: unresolved artifact records outlive accounts.
  await boss.createQueue('recover-data-exports')
  await boss.schedule('recover-data-exports', '* * * * *', {}, { missed: 'once' })
  await boss.work('recover-data-exports', { localConcurrency: 1, batchSize: 1 }, async () => lifecycle.run(async signal => {
    try {
      const { recoverDataExports } = await import('../services/data-export-artifacts')
      if (signal.aborted) return
      await recoverDataExports()
      pingHealthcheck('recover-data-exports')
    } catch {
      const error = new Error('DATA_EXPORT_RECOVERY_RETRY_REQUIRED')
      Sentry.captureException(error)
      throw error
    }
  }))

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

  // Matching jobs share the T01 lifecycle: abort first, retain promises until settlement.
  await boss.createQueue('matching-index')
  await boss.work<{ indexId: string; generation: number }>('matching-index', { localConcurrency: 1, batchSize: 1 }, async jobs => {
    for (const job of jobs) await lifecycle.run(async shutdownSignal => {
      const signal = AbortSignal.any([shutdownSignal, job.signal])
      if (signal.aborted) return
      try {
        const { runMatchingIndex } = await import('./index-matching')
        if (!signal.aborted) await runMatchingIndex(job.data, { signal })
      } catch {
        const error = new Error('MATCHING_INDEX_JOB_FAILED')
        Sentry.captureException(error)
        throw error
      }
    })
  })

  await boss.createQueue('dispatch-matching-indexes')
  await boss.schedule('dispatch-matching-indexes', '* * * * *', {}, { missed: 'once' })
  await boss.work('dispatch-matching-indexes', { localConcurrency: 1, batchSize: 1 }, async jobs => {
    for (const job of jobs) await lifecycle.run(async shutdownSignal => {
      const signal = AbortSignal.any([shutdownSignal, job.signal])
      if (signal.aborted) return
      try {
        const { dispatchPendingMatchingIndexes } = await import('../services/semantic-matching')
        if (!signal.aborted) await dispatchPendingMatchingIndexes({ signal, send: payload => boss.send('matching-index', payload) })
        if (!signal.aborted) pingHealthcheck('dispatch-matching-indexes')
      } catch {
        const error = new Error('MATCHING_INDEX_DISPATCH_FAILED')
        Sentry.captureException(error)
        throw error
      }
    })
  })

  const { getSetting } = await import('../services/settings')
  const rawMinutes = await getSetting<unknown>('ai.matching.reconcileEveryMinutes', 5, { fresh: true })
  const minutes = typeof rawMinutes === 'number' && Number.isInteger(rawMinutes) && rawMinutes >= 1 && rawMinutes <= 30 ? rawMinutes : 5
  await boss.createQueue('reconcile-matching-corpus')
  await boss.schedule('reconcile-matching-corpus', `*/${minutes} * * * *`, {}, { missed: 'once' })
  await boss.work('reconcile-matching-corpus', { localConcurrency: 1, batchSize: 1 }, async jobs => {
    for (const job of jobs) await lifecycle.run(async shutdownSignal => {
      const signal = AbortSignal.any([shutdownSignal, job.signal])
      if (signal.aborted) return
      try {
        const { reconcileMatchingCorpus } = await import('../services/semantic-matching')
        if (!signal.aborted) await reconcileMatchingCorpus({ signal })
        if (!signal.aborted) pingHealthcheck('reconcile-matching-corpus')
      } catch {
        const error = new Error('MATCHING_CORPUS_RECONCILE_FAILED')
        Sentry.captureException(error)
        throw error
      }
    })
  })

  // Weekly callbacks retain ownership through actual settlement, including timeout tails.
  const weeklyPayload = z.object({ deliveryId: z.string().cuid() }).strict()
  const emptyPayload = z.object({}).strict()
  await boss.createQueue('weekly-digest')
  await boss.work<{ deliveryId: string }>('weekly-digest', { localConcurrency: 1, batchSize: 1 }, async jobs => {
    for (const job of jobs) await lifecycle.run(async shutdownSignal => {
      const signal = AbortSignal.any([shutdownSignal, job.signal])
      if (signal.aborted) return
      const payload = weeklyPayload.safeParse(job.data)
      if (!payload.success) throw new Error('WEEKLY_DIGEST_PAYLOAD_INVALID')
      const { runWeeklyDigest, drainWeeklyDigestWork } = await import('./weekly-digest')
      try { if (!signal.aborted) await runWeeklyDigest(payload.data, { signal }) }
      catch { throw new Error('WEEKLY_DIGEST_JOB_FAILED') }
      finally { await drainWeeklyDigestWork() }
    })
  })
  for (const [name, cron] of [['schedule-weekly-digests', '0 8 * * 1'], ['recover-weekly-digests', '0 * * * *']] as const) {
    await boss.createQueue(name)
    await boss.schedule(name, cron, {}, { tz: 'Asia/Kuala_Lumpur', missed: 'once' })
    await boss.work(name, { localConcurrency: 1, batchSize: 1 }, async jobs => {
      for (const job of jobs) await lifecycle.run(async shutdownSignal => {
        const signal = AbortSignal.any([shutdownSignal, job.signal])
        if (signal.aborted) return
        if (!emptyPayload.safeParse(job.data).success) throw new Error('WEEKLY_DIGEST_PAYLOAD_INVALID')
        const weekly = await import('./weekly-digest')
        try {
          if (signal.aborted) return
          const options = { signal, send: (payload: { deliveryId: string }) => boss.send('weekly-digest', payload) }
          if (name === 'schedule-weekly-digests') await weekly.scheduleWeeklyDigests(options)
          else await weekly.recoverWeeklyDigests(options)
          if (!signal.aborted) pingHealthcheck(name)
        } catch { throw new Error('WEEKLY_DIGEST_SCHEDULER_FAILED') }
        finally { await weekly.drainWeeklyDigestWork() }
      })
    })
  }

  logger.info('jobs registered')
}
