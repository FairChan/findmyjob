import { db } from '../db'
import { getSetting } from '../services/settings'
import { grantPilotCredits } from '../services/credits'
import { getValidatedPilotMonthlyCredits, klMonthStartUtc, notifyCreditsGranted } from '../services/pilot-credits'
import { logger } from '../lib/logger'
import { alert } from '../lib/alert'

/** Scheduled job: top up all verified companies at the start of each month. */
export async function runPilotMonthlyCredits(): Promise<void> {
  const billingEnabled = await getSetting<unknown>('billing.enabled', false, { fresh: true })
  if (billingEnabled !== false) {
    logger.info('pilot-monthly-credits: skipped (billing.enabled=true)')
    return
  }

  const monthlyCredits = await getValidatedPilotMonthlyCredits()
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
