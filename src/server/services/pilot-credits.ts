import 'server-only'
import { db } from '../db'
import { getSetting } from './settings'
import { grantPilotCredits, getBalance } from './credits'
import { createNotification } from './notifications'
import { sendNotificationEmail } from './notify'
import { logger } from '../lib/logger'
import { alert } from '../lib/alert'

/** Start of the current Asia/Kuala_Lumpur month (UTC+8), expressed as UTC. */
export function klMonthStartUtc(): Date {
  const klNow = new Date(Date.now() + 8 * 60 * 60 * 1000)
  return new Date(Date.UTC(klNow.getUTCFullYear(), klNow.getUTCMonth(), 1) - 8 * 60 * 60 * 1000)
}

export async function getValidatedPilotMonthlyCredits(): Promise<number> {
  const key = 'pilot.monthlyCredits'
  const defaultValue = 30
  const value = await getSetting<unknown>(key, defaultValue)
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return value
  logger.warn({ key, defaultValue }, 'Invalid pilot credit setting; using default')
  return defaultValue
}

/** Immediately top up a newly verified company during the pilot period. */
export async function grantPilotCreditsOnVerification(companyId: string): Promise<void> {
  try {
    const billingEnabled = await getSetting<boolean>('billing.enabled', false)
    if (billingEnabled) return

    const monthlyCredits = await getValidatedPilotMonthlyCredits()
    const result = await grantPilotCredits(companyId, monthlyCredits, klMonthStartUtc())
    logger.info({ companyId, ...result }, 'pilot-credits: immediate grant on verification')

    if (result.granted > 0) {
      await notifyCreditsGranted(companyId, result.granted).catch(() => {})
    }
  } catch (err) {
    logger.error({ err, companyId }, 'pilot-credits: immediate grant failed')
    alert('pilot.grant.failed', { companyId })
    throw err
  }
}

/** Call after the grant commits; callers isolate notification failures. */
export async function notifyCreditsGranted(companyId: string, amount: number): Promise<void> {
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
