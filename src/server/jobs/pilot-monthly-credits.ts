import 'server-only'
import { db } from '../db'
import { getSetting } from '../services/settings'
import { grantPilotCredits, getBalance } from '../services/credits'
import { createNotification } from '../services/notifications'
import { sendNotificationEmail } from '../services/notify'
import { logger } from '../lib/logger'
import { alert } from '../lib/alert'

/** Returns the start of the current month in Asia/Kuala_Lumpur (UTC+8), expressed as a UTC Date. */
function klMonthStartUtc(): Date {
  const now = new Date()
  // Shift to KL time (UTC+8) to determine the current KL year/month
  const klMs = now.getTime() + 8 * 60 * 60 * 1000
  const klNow = new Date(klMs)
  // KL month start = midnight KL on the 1st = subtract 8h from UTC midnight on the 1st
  return new Date(Date.UTC(klNow.getUTCFullYear(), klNow.getUTCMonth(), 1) - 8 * 60 * 60 * 1000)
}

/**
 * Called immediately when a company is verified (approval or managed company creation).
 * Skips when billing is enabled (not in pilot period).
 */
export async function grantPilotCreditsOnVerification(companyId: string): Promise<void> {
  try {
    const billingEnabled = await getSetting<boolean>('billing.enabled', false)
    if (billingEnabled) return

    const monthlyCredits = await getSetting<number>('pilot.monthlyCredits', 30)
    const monthStart = klMonthStartUtc()

    const result = await grantPilotCredits(companyId, monthlyCredits, monthStart)
    logger.info({ companyId, ...result }, 'pilot-credits: immediate grant on verification')

    // Notify OWNER post-commit if credits were actually granted
    if (result.granted > 0) {
      await notifyCreditsGranted(companyId, result.granted).catch(() => {})
    }
  } catch (err) {
    logger.error({ err, companyId }, 'pilot-credits: immediate grant failed')
    alert('pilot.grant.failed', { companyId })
    throw err
  }
}

/** Scheduled job: top up all verified companies at the start of each month. */
export async function runPilotMonthlyCredits(): Promise<void> {
  const billingEnabled = await getSetting<boolean>('billing.enabled', false)
  if (billingEnabled) {
    logger.info('pilot-monthly-credits: skipped (billing.enabled=true)')
    return
  }

  const monthlyCredits = await getSetting<number>('pilot.monthlyCredits', 30)
  const monthStart = klMonthStartUtc()

  const companies = await db.company.findMany({
    where: { verificationStatus: 'VERIFIED', isActive: true, wallet: { isNot: null } },
    select: { id: true },
  })

  let totalGranted = 0
  let totalSkipped = 0
  const failed: string[] = []

  for (const company of companies) {
    try {
      const result = await grantPilotCredits(company.id, monthlyCredits, monthStart)
      if (result.granted > 0) {
        totalGranted++
        await notifyCreditsGranted(company.id, result.granted).catch(() => {})
      } else {
        totalSkipped++
      }
    } catch (err) {
      logger.error({ err, companyId: company.id }, 'pilot-grant: company failed')
      alert('pilot.grant.failed', { companyId: company.id })
      failed.push(company.id)
    }
  }

  logger.info(
    { total: companies.length, granted: totalGranted, skipped: totalSkipped, failed: failed.length, monthlyCredits },
    'pilot-monthly-credits completed',
  )

  if (failed.length > 0) {
    throw new Error(`pilot-monthly-credits: ${failed.length} company(ies) failed`)
  }
}

/** Notify the OWNER of a company that credits were granted (best-effort, post-commit). */
async function notifyCreditsGranted(companyId: string, amount: number): Promise<void> {
  const owner = await db.companyMember.findFirst({
    where: { companyId, role: 'OWNER' },
    select: { userId: true },
  })
  if (!owner) return

  const walletBalance = await getBalance({ userId: owner.userId, companyId })
  const balance = walletBalance ?? amount

  await createNotification(db, owner.userId, 'credits.granted', {
    companyId,
    amount,
    balance,
  })
  await sendNotificationEmail(owner.userId, {
    template: 'credits-granted',
    amount,
    balance,
  })
}
