import 'server-only'
import { LedgerReason, type Prisma } from '@prisma/client'
import { db } from '../db'
import { InsufficientCreditsError } from '../errors'
import { logAudit } from './audit'
import { lockXact, LOCK_NS } from '../lib/advisory-locks'

export interface LedgerEntryParams {
  companyId: string
  delta: number
  reason: LedgerReason
  refType?: string
  refId?: string
  actorId?: string
  note?: string
}

function assertInsideTransaction(tx: Prisma.TransactionClient): void {
  if ('$transaction' in (tx as object)) {
    throw new Error('applyLedgerEntry must be called inside a prisma.$transaction')
  }
}

export async function applyLedgerEntry(
  tx: Prisma.TransactionClient,
  params: LedgerEntryParams
): Promise<{ balanceAfter: number }> {
  assertInsideTransaction(tx)

  await lockXact(tx, LOCK_NS.CREDIT, params.companyId)

  const wallet = await tx.creditWallet.findUnique({
    where: { companyId: params.companyId },
    select: { id: true, balance: true },
  })

  if (!wallet) {
    throw new Error(`No wallet found for company ${params.companyId}`)
  }

  const newBalance = wallet.balance + params.delta
  if (newBalance < 0) {
    throw new InsufficientCreditsError()
  }

  await tx.creditLedger.create({
    data: {
      walletId: wallet.id,
      delta: params.delta,
      balanceAfter: newBalance,
      reason: params.reason,
      refType: params.refType ?? null,
      refId: params.refId ?? null,
      actorId: params.actorId ?? null,
      note: params.note ?? null,
    },
  })

  await tx.creditWallet.update({
    where: { id: wallet.id },
    data: { balance: newBalance },
  })

  return { balanceAfter: newBalance }
}

export async function getBalance(ctx: { userId: string; companyId: string }): Promise<number | null> {
  const wallet = await db.creditWallet.findUnique({
    where: { companyId: ctx.companyId },
    select: { balance: true },
  })
  return wallet?.balance ?? null
}

/** @deprecated Use getBalance */
export const getWalletBalance = getBalance

export async function adminAdjust(
  ctx: { actorId: string },
  params: { companyId: string; delta: number; note: string }
): Promise<{ balanceAfter: number }> {
  const result = await db.$transaction(async (tx) => {
    return applyLedgerEntry(tx, {
      companyId: params.companyId,
      delta: params.delta,
      reason: LedgerReason.ADMIN_ADJUST,
      actorId: ctx.actorId,
      note: params.note,
    })
  })

  await logAudit({
    actorId: ctx.actorId,
    action: 'credits.adjust',
    targetType: 'CreditWallet',
    targetId: params.companyId,
    metadata: { delta: params.delta, note: params.note, balanceAfter: result.balanceAfter },
  })

  return result
}

export async function reconcileWallet(ctx: { companyId: string }): Promise<{
  ok: boolean
  expected: number
  actual: number
}> {
  const wallet = await db.creditWallet.findUnique({
    where: { companyId: ctx.companyId },
    select: {
      balance: true,
      ledger: { select: { delta: true } },
    },
  })

  if (!wallet) {
    return { ok: true, expected: 0, actual: 0 }
  }

  const expected = wallet.ledger.reduce((sum, entry) => sum + entry.delta, 0)
  const actual = wallet.balance

  return { ok: expected === actual, expected, actual }
}
