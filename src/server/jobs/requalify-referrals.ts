import { logger } from '../lib/logger'
import { requalifyReferrals } from '../services/referrals'

export async function runRequalifyReferrals(): Promise<void> {
  const { qualified } = await requalifyReferrals()
  logger.info({ qualified }, 'requalify-referrals: completed')
}
