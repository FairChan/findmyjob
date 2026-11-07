import 'server-only'
import type { Prisma } from '@prisma/client'
import { db } from '../db'

export async function createWallet(tx: Prisma.TransactionClient, companyId: string): Promise<void> {
  await tx.creditWallet.create({ data: { companyId, balance: 0 } })
}

/**
 * Returns the credit wallet balance for a company, or null if no wallet exists yet.
 * CreditWallet is created when a company is first verified (see review-company.ts).
 * Balance changes must go through applyLedgerEntry (not implemented in this task).
 */
export async function getWalletBalance(ctx: { userId: string; companyId: string }): Promise<number | null> {
  const wallet = await db.creditWallet.findUnique({
    where: { companyId: ctx.companyId },
    select: { balance: true },
  })
  return wallet?.balance ?? null
}
