import 'server-only'
import { Prisma } from '@prisma/client'
import { db } from '../db'
import { alert } from '../lib/alert'
import { logger } from '../lib/logger'

interface WalletMismatch {
  companyId: string
  expected: number
  actual: number
}

/** Daily reconciliation: compares each wallet's balance against SUM(ledger.delta). */
export async function runReconcileWallets(): Promise<void> {
  const rows = await db.$queryRaw<WalletMismatch[]>(
    Prisma.sql`
      SELECT w."companyId",
             COALESCE(SUM(l."delta"), 0)::int AS expected,
             w."balance" AS actual
      FROM   "CreditWallet" w
      LEFT JOIN "CreditLedger" l ON l."walletId" = w."id"
      GROUP BY w."companyId", w."balance"
      HAVING COALESCE(SUM(l."delta"), 0) <> w."balance"
    `,
  )

  if (rows.length === 0) {
    logger.info('reconcile-wallets: all wallets balanced')
    return
  }

  for (const row of rows) {
    alert('wallet.mismatch', {
      companyId: row.companyId,
      expected: Number(row.expected),
      actual: Number(row.actual),
    })
  }

  logger.warn({ count: rows.length }, 'reconcile-wallets: mismatches found')
}
