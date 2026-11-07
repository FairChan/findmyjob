import 'server-only'
import { db } from '../db'
import { getSetting } from '../services/settings'
import { grantPilotCredits } from '../services/credits'
import { logger } from '../lib/logger'

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
  const billingEnabled = await getSetting<boolean>('billing.enabled', false)
  if (billingEnabled) return

  const monthlyCredits = await getSetting<number>('pilot.monthlyCredits', 30)
  const monthStart = klMonthStartUtc()

  const result = await grantPilotCredits(companyId, monthlyCredits, monthStart)
  logger.info({ companyId, ...result }, 'pilot-credits: immediate grant on verification')
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

  for (const company of companies) {
    const result = await grantPilotCredits(company.id, monthlyCredits, monthStart)
    if (result.granted > 0) totalGranted++
    else totalSkipped++
  }

  logger.info(
    { total: companies.length, granted: totalGranted, skipped: totalSkipped, monthlyCredits },
    'pilot-monthly-credits completed',
  )
}
