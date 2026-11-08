import 'server-only'
import { db } from '../db'
import { logger } from '../lib/logger'

const BATCH_SIZE = 1000

/**
 * Marks SENT invitations whose expiresAt has passed as EXPIRED.
 * Processes in batches of BATCH_SIZE ordered by primary key.
 */
export async function runExpireInvitations(): Promise<void> {
  const now = new Date()
  let total = 0
  let cursor: string | undefined

  while (true) {
    const rows = await db.invitation.findMany({
      where: {
        status: 'SENT',
        expiresAt: { lt: now },
        ...(cursor ? { id: { gt: cursor } } : {}),
      },
      orderBy: { id: 'asc' },
      take: BATCH_SIZE,
      select: { id: true },
    })

    if (rows.length === 0) break

    const ids = rows.map((r) => r.id)
    await db.invitation.updateMany({
      where: { id: { in: ids }, status: 'SENT' },
      data: { status: 'EXPIRED' },
    })

    total += rows.length
    cursor = rows[rows.length - 1].id

    if (rows.length < BATCH_SIZE) break
  }

  logger.info({ expired: total }, 'expire-invitations completed')
}
