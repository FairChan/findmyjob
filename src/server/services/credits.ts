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
  return db.$transaction(async (tx) => {
    const result = await applyLedgerEntry(tx, {
      companyId: params.companyId,
      delta: params.delta,
      reason: LedgerReason.ADMIN_ADJUST,
      actorId: ctx.actorId,
      note: params.note,
    })

    // Audit inside the transaction so a write failure rolls back the ledger entry
    await logAudit({
      actorId: ctx.actorId,
      action: 'credits.adjust',
      targetType: 'CreditWallet',
      targetId: params.companyId,
      metadata: { delta: params.delta, note: params.note, balanceAfter: result.balanceAfter },
    }, tx)

    return result
  })
}

/** Creates a fresh wallet with zero balance for a newly verified company. */
export async function createWallet(companyId: string): Promise<void> {
  await db.creditWallet.create({ data: { companyId, balance: 0 } })
}

export interface GrantPilotCreditsResult {
  granted: number
  reason: 'ok' | 'already_granted' | 'balance_sufficient' | 'no_wallet'
}

/**
 * Top-up system (补足制): grant enough PILOT_GRANT credits to bring the wallet up to
 * monthlyCredits. Skips if already granted this KL month (idempotency) or if the
 * balance is already at or above the quota.
 * Must NOT be called inside an existing db.$transaction.
 */
export async function grantPilotCredits(
  companyId: string,
  monthlyCredits: number,
  monthStart: Date,
): Promise<GrantPilotCreditsResult> {
  return db.$transaction(async tx => {
    await lockXact(tx, LOCK_NS.CREDIT, companyId)

    // Idempotency: skip if already granted a PILOT_GRANT in this KL month
    const alreadyGranted = await tx.creditLedger.findFirst({
      where: {
        wallet: { companyId },
        reason: LedgerReason.PILOT_GRANT,
        createdAt: { gte: monthStart },
      },
      select: { id: true },
    })
    if (alreadyGranted) return { granted: 0, reason: 'already_granted' as const }

    const wallet = await tx.creditWallet.findUnique({
      where: { companyId },
      select: { balance: true },
    })
    if (!wallet) return { granted: 0, reason: 'no_wallet' as const }

    const topUp = monthlyCredits - wallet.balance
    if (topUp <= 0) return { granted: 0, reason: 'balance_sufficient' as const }

    await applyLedgerEntry(tx, {
      companyId,
      delta: topUp,
      reason: LedgerReason.PILOT_GRANT,
    })

    return { granted: topUp, reason: 'ok' as const }
  })
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
