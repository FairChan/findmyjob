/**
 * Integration tests for credits service (M4-T06).
 */
import { vi, describe, it, expect, beforeEach } from 'vitest'

vi.mock('@/server/auth', () => ({
  getSession: vi.fn(),
  auth: {},
}))

vi.mock('@/server/db', async () => {
  const { testDb } = await import('../setup/db')
  return { db: testDb }
})

import { LedgerReason } from '@prisma/client'
import { setupTestDb, testDb } from '../setup/db'
import { createEmployer } from '../factories'
import { applyLedgerEntry, getBalance, getWalletBalance, adminAdjust, reconcileWallet } from '@/server/services/credits'
import { InsufficientCreditsError } from '@/server/errors'

setupTestDb()

async function createWallet(companyId: string, balance = 0) {
  return testDb.creditWallet.create({ data: { companyId, balance } })
}

describe('getBalance / getWalletBalance', () => {
  it('returns null when company has no wallet', async () => {
    const { userId, companyId } = await createEmployer(testDb)
    expect(await getBalance({ userId, companyId })).toBeNull()
  })

  it('returns 0 when wallet exists with zero balance', async () => {
    const { userId, companyId } = await createEmployer(testDb)
    await createWallet(companyId, 0)
    expect(await getBalance({ userId, companyId })).toBe(0)
  })

  it('returns correct balance when wallet has credits', async () => {
    const { userId, companyId } = await createEmployer(testDb)
    await createWallet(companyId, 150)
    expect(await getBalance({ userId, companyId })).toBe(150)
  })

  it('backward-compat alias getWalletBalance works', async () => {
    const { userId, companyId } = await createEmployer(testDb)
    await createWallet(companyId, 50)
    expect(await getWalletBalance({ userId, companyId })).toBe(50)
  })
})

describe('applyLedgerEntry', () => {
  it('throws when called outside a transaction', async () => {
    const { companyId } = await createEmployer(testDb)
    await createWallet(companyId, 100)
    // Passing db (PrismaClient) instead of a transaction client should throw
    await expect(
      applyLedgerEntry(testDb as Parameters<typeof applyLedgerEntry>[0], {
        companyId,
        delta: 10,
        reason: LedgerReason.PILOT_GRANT,
      })
    ).rejects.toThrow('prisma.$transaction')
  })

  it('credits the wallet and creates a ledger entry', async () => {
    const { companyId } = await createEmployer(testDb)
    await createWallet(companyId, 50)

    const result = await testDb.$transaction(async (tx) => {
      return applyLedgerEntry(tx, {
        companyId,
        delta: 30,
        reason: LedgerReason.PILOT_GRANT,
      })
    })

    expect(result.balanceAfter).toBe(80)

    const wallet = await testDb.creditWallet.findUnique({ where: { companyId }, select: { balance: true } })
    expect(wallet?.balance).toBe(80)

    const ledger = await testDb.creditLedger.findMany({ where: { wallet: { companyId } } })
    expect(ledger).toHaveLength(1)
    expect(ledger[0].delta).toBe(30)
    expect(ledger[0].balanceAfter).toBe(80)
    expect(ledger[0].reason).toBe(LedgerReason.PILOT_GRANT)
  })

  it('balanceAfter is consecutive across multiple entries', async () => {
    const { companyId } = await createEmployer(testDb)
    await createWallet(companyId, 100)

    await testDb.$transaction(async (tx) => {
      await applyLedgerEntry(tx, { companyId, delta: -20, reason: LedgerReason.UNLOCK })
    })
    await testDb.$transaction(async (tx) => {
      await applyLedgerEntry(tx, { companyId, delta: -30, reason: LedgerReason.UNLOCK })
    })
    await testDb.$transaction(async (tx) => {
      await applyLedgerEntry(tx, { companyId, delta: 10, reason: LedgerReason.REFUND })
    })

    const ledger = await testDb.creditLedger.findMany({
      where: { wallet: { companyId } },
      orderBy: { createdAt: 'asc' },
    })
    expect(ledger[0].balanceAfter).toBe(80)
    expect(ledger[1].balanceAfter).toBe(50)
    expect(ledger[2].balanceAfter).toBe(60)

    const wallet = await testDb.creditWallet.findUnique({ where: { companyId }, select: { balance: true } })
    expect(wallet?.balance).toBe(60)
  })

  it('throws InsufficientCreditsError when balance would go negative', async () => {
    const { companyId } = await createEmployer(testDb)
    await createWallet(companyId, 10)

    await expect(
      testDb.$transaction(async (tx) => {
        return applyLedgerEntry(tx, { companyId, delta: -20, reason: LedgerReason.UNLOCK })
      })
    ).rejects.toThrow(InsufficientCreditsError)
  })

  it('allows exact depletion to zero', async () => {
    const { companyId } = await createEmployer(testDb)
    await createWallet(companyId, 10)

    const result = await testDb.$transaction(async (tx) => {
      return applyLedgerEntry(tx, { companyId, delta: -10, reason: LedgerReason.UNLOCK })
    })

    expect(result.balanceAfter).toBe(0)
  })

  it('stores optional fields refType, refId, actorId, note', async () => {
    const { companyId, userId } = await createEmployer(testDb)
    await createWallet(companyId, 100)

    await testDb.$transaction(async (tx) => {
      return applyLedgerEntry(tx, {
        companyId,
        delta: -5,
        reason: LedgerReason.UNLOCK,
        refType: 'TalentUnlock',
        refId: 'unlock-abc',
        actorId: userId,
        note: 'test note',
      })
    })

    const entry = await testDb.creditLedger.findFirst({ where: { wallet: { companyId } } })
    expect(entry?.refType).toBe('TalentUnlock')
    expect(entry?.refId).toBe('unlock-abc')
    expect(entry?.actorId).toBe(userId)
    expect(entry?.note).toBe('test note')
  })

  it('throws when no wallet exists', async () => {
    const { companyId } = await createEmployer(testDb)

    await expect(
      testDb.$transaction(async (tx) => {
        return applyLedgerEntry(tx, { companyId, delta: 10, reason: LedgerReason.PILOT_GRANT })
      })
    ).rejects.toThrow('No wallet found')
  })
})

describe('adminAdjust', () => {
  it('adjusts balance and writes credits.adjust audit', async () => {
    const { userId, companyId } = await createEmployer(testDb)
    await createWallet(companyId, 50)

    const result = await adminAdjust({ actorId: userId }, { companyId, delta: 100, note: 'manual top-up' })
    expect(result.balanceAfter).toBe(150)

    const wallet = await testDb.creditWallet.findUnique({ where: { companyId }, select: { balance: true } })
    expect(wallet?.balance).toBe(150)

    const auditLog = await testDb.auditLog.findFirst({
      where: { action: 'credits.adjust', actorId: userId, targetId: companyId },
    })
    expect(auditLog).not.toBeNull()
    expect(auditLog?.metadata).toMatchObject({ delta: 100, note: 'manual top-up', balanceAfter: 150 })
  })

  it('ledger entry has ADMIN_ADJUST reason', async () => {
    const { userId, companyId } = await createEmployer(testDb)
    await createWallet(companyId, 0)

    await adminAdjust({ actorId: userId }, { companyId, delta: 50, note: 'grant' })

    const entry = await testDb.creditLedger.findFirst({ where: { wallet: { companyId } } })
    expect(entry?.reason).toBe(LedgerReason.ADMIN_ADJUST)
    expect(entry?.actorId).toBe(userId)
  })

  it('throws InsufficientCreditsError when deducting below zero', async () => {
    const { userId, companyId } = await createEmployer(testDb)
    await createWallet(companyId, 10)

    await expect(
      adminAdjust({ actorId: userId }, { companyId, delta: -20, note: 'correction' })
    ).rejects.toThrow(InsufficientCreditsError)
  })
})

describe('reconcileWallet', () => {
  it('returns ok:true and 0/0 when wallet does not exist', async () => {
    const { companyId } = await createEmployer(testDb)
    const result = await reconcileWallet({ companyId })
    expect(result).toEqual({ ok: true, expected: 0, actual: 0 })
  })

  it('returns ok:true when balance matches ledger sum', async () => {
    const { companyId, userId } = await createEmployer(testDb)
    await createWallet(companyId, 0)

    await adminAdjust({ actorId: userId }, { companyId, delta: 100, note: 'grant' })
    await testDb.$transaction(async (tx) => {
      await applyLedgerEntry(tx, { companyId, delta: -20, reason: LedgerReason.UNLOCK })
    })

    const result = await reconcileWallet({ companyId })
    expect(result).toEqual({ ok: true, expected: 80, actual: 80 })
  })

  it('returns ok:false when balance does not match ledger sum', async () => {
    const { companyId } = await createEmployer(testDb)
    await createWallet(companyId, 999)
    // Directly create a ledger entry with wrong sum (bypassing balance update)
    const wallet = await testDb.creditWallet.findUniqueOrThrow({ where: { companyId } })
    await testDb.creditLedger.create({
      data: { walletId: wallet.id, delta: 50, balanceAfter: 50, reason: LedgerReason.PILOT_GRANT },
    })

    const result = await reconcileWallet({ companyId })
    expect(result.ok).toBe(false)
    expect(result.expected).toBe(50)
    expect(result.actual).toBe(999)
  })
})
