import { logger } from '../lib/logger'
import { purgeUnverifiedAccounts } from '../services/signup-cap'

export async function runPurgeUnverified(): Promise<void> {
  const count = await purgeUnverifiedAccounts()
  logger.info({ count }, 'purge-unverified: deleted unverified student accounts')
}
