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
 * Returns the KL month string "YYYY-MM" for a given KL month-start UTC date
 * (as produced by klMonthStartUtc in pilot-monthly-credits.ts).
 */
function klMonthRefId(monthStart: Date): string {
  // monthStart is UTC midnight of KL 1st minus 8h; add 8h to get KL midnight
  const klMidnight = new Date(monthStart.getTime() + 8 * 60 * 60 * 1000)
  const year = klMidnight.getUTCFullYear()
  const month = String(klMidnight.getUTCMonth() + 1).padStart(2, '0')
  return `${year}-${month}`
}

/**
 * Top-up system (补足制): bring the wallet up to monthlyCredits for the given KL month.
 * Always writes a CreditLedger row (even when delta=0) so that re-runs are idempotent
 * by refType/refId rather than by createdAt. Delta=0 rows mean "checked, no top-up needed".
 * Must NOT be called inside an existing db.$transaction.
 */
export async function grantPilotCredits(
  companyId: string,
  monthlyCredits: number,
  monthStart: Date,
): Promise<GrantPilotCreditsResult> {
  const refId = klMonthRefId(monthStart)

  return db.$transaction(async tx => {
    await lockXact(tx, LOCK_NS.CREDIT, companyId)

    // Idempotency: skip if already processed this KL month (delta=0 rows count)
    const alreadyProcessed = await tx.creditLedger.findFirst({
      where: {
        wallet: { companyId },
        refType: 'PilotPeriod',
        refId,
      },
      select: { id: true },
    })
    if (alreadyProcessed) return { granted: 0, reason: 'already_granted' as const }

    const wallet = await tx.creditWallet.findUnique({
      where: { companyId },
      select: { balance: true },
    })
    if (!wallet) return { granted: 0, reason: 'no_wallet' as const }

    const topUp = Math.max(0, monthlyCredits - wallet.balance)

    // Always write a row (even topUp=0) to record "checked this month"
    await applyLedgerEntry(tx, {
      companyId,
      delta: topUp,
      reason: LedgerReason.PILOT_GRANT,
      refType: 'PilotPeriod',
      refId,
    })

    return { granted: topUp, reason: topUp > 0 ? ('ok' as const) : ('balance_sufficient' as const) }
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
