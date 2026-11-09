/**
 * Integration tests for credits service (M4-T06).
 */
import { vi, describe, it, expect } from 'vitest'

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
import { createAdmin, createEmployer } from '../factories'
import { applyLedgerEntry, getBalance, getWalletBalance, adminAdjust, reconcileWallet } from '@/server/services/credits'
import { ForbiddenError, InsufficientCreditsError, ValidationError } from '@/server/errors'

setupTestDb()

async function createWallet(companyId: string, balance = 0) {
  return testDb.creditWallet.create({ data: { companyId, balance } })
}

// Coordinate a real concurrent write after the service reads a wallet. No
// database result is mocked: the other writer commits before the service resumes.
function withWalletReadInterleaving(companyId: string, afterRead: () => Promise<void>) {
  let interleaved = false
  return testDb.$extends({
    query: {
      creditWallet: {
        async findUnique({ args, query }) {
          const wallet = await query(args)
          if (!interleaved && args.where.companyId === companyId) {
            interleaved = true
            await afterRead()
          }
          return wallet
        },
      },
    },
  })
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

  it('rejects a debit when another committed writer depletes the wallet after its initial read', async () => {
    const { companyId } = await createEmployer(testDb)
    const wallet = await createWallet(companyId)
    await testDb.$transaction((tx) => applyLedgerEntry(tx, {
      companyId, delta: 10, reason: LedgerReason.PILOT_GRANT,
    }))

    const interleavedDb = withWalletReadInterleaving(companyId, async () => {
      // Deliberately bypass the cooperative advisory lock to exercise the
      // conditional database update that must defend against a stale read.
      await testDb.$transaction(async (otherTx) => {
        await otherTx.creditWallet.update({ where: { id: wallet.id }, data: { balance: 0 } })
        await otherTx.creditLedger.create({ data: {
          walletId: wallet.id, delta: -10, balanceAfter: 0,
          reason: LedgerReason.ADMIN_ADJUST, refId: 'concurrent-depletion',
        } })
      })
    })

    // Query extensions retain the runtime transaction API but widen Prisma's generated types.
    await expect(interleavedDb.$transaction((tx) => applyLedgerEntry(tx as unknown as Parameters<typeof applyLedgerEntry>[0], {
      companyId, delta: -5, reason: LedgerReason.UNLOCK,
    }))).rejects.toBeInstanceOf(InsufficientCreditsError)

    expect(await testDb.creditWallet.findUnique({ where: { id: wallet.id } })).toMatchObject({ balance: 0 })
    expect(await testDb.creditLedger.count({ where: { walletId: wallet.id, refId: 'concurrent-depletion' } })).toBe(1)
    expect(await testDb.creditLedger.count({ where: { walletId: wallet.id, reason: LedgerReason.UNLOCK } })).toBe(0)
    expect(await reconcileWallet({ companyId })).toEqual({ ok: true, expected: 0, actual: 0 })
  })

  it('increments the current balance without overwriting a credit committed after its initial read', async () => {
    const { companyId } = await createEmployer(testDb)
    const wallet = await createWallet(companyId)
    await testDb.$transaction((tx) => applyLedgerEntry(tx, {
      companyId, delta: 10, reason: LedgerReason.PILOT_GRANT,
    }))

    const interleavedDb = withWalletReadInterleaving(companyId, async () => {
      await testDb.$transaction(async (otherTx) => {
        await otherTx.creditWallet.update({ where: { id: wallet.id }, data: { balance: { increment: 20 } } })
        await otherTx.creditLedger.create({ data: {
          walletId: wallet.id, delta: 20, balanceAfter: 30,
          reason: LedgerReason.ADMIN_ADJUST, refId: 'concurrent-credit',
        } })
      })
    })

    const result = await interleavedDb.$transaction((tx) => applyLedgerEntry(tx as unknown as Parameters<typeof applyLedgerEntry>[0], {
      companyId, delta: 5, reason: LedgerReason.REFUND, refId: 'after-concurrent-credit',
    }))

    expect(result).toEqual({ balanceAfter: 35 })
    expect(await testDb.creditWallet.findUnique({ where: { id: wallet.id } })).toMatchObject({ balance: 35 })
    expect(await testDb.creditLedger.findFirst({ where: { walletId: wallet.id, refId: 'after-concurrent-credit' } }))
      .toMatchObject({ delta: 5, balanceAfter: 35 })
    expect(await reconcileWallet({ companyId })).toEqual({ ok: true, expected: 35, actual: 35 })
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
    const { companyId } = await createEmployer(testDb)
    const { userId } = await createAdmin(testDb)
    await createWallet(companyId, 50)

    const note = '  manual top-up  '
    const result = await adminAdjust({ actorId: userId }, { companyId, delta: 100, note })
    expect(result.balanceAfter).toBe(150)

    const wallet = await testDb.creditWallet.findUnique({ where: { companyId }, select: { balance: true } })
    expect(wallet?.balance).toBe(150)

    const auditLog = await testDb.auditLog.findFirst({
      where: { action: 'credits.adjust', actorId: userId, targetId: companyId },
    })
    expect(auditLog).not.toBeNull()
    expect(auditLog?.metadata).toEqual({ delta: 100, noteLength: note.trim().length, balanceAfter: 150 })
    expect(JSON.stringify(auditLog?.metadata)).not.toContain(note.trim())
    const entry = await testDb.creditLedger.findFirst({ where: { wallet: { companyId } } })
    expect(entry?.note).toBe(note.trim())
  })

  it('ledger entry has ADMIN_ADJUST reason', async () => {
    const { companyId } = await createEmployer(testDb)
    const { userId } = await createAdmin(testDb)
    await createWallet(companyId, 0)

    await adminAdjust({ actorId: userId }, { companyId, delta: 50, note: 'grant' })

    const entry = await testDb.creditLedger.findFirst({ where: { wallet: { companyId } } })
    expect(entry?.reason).toBe(LedgerReason.ADMIN_ADJUST)
    expect(entry?.actorId).toBe(userId)
  })

  it('throws InsufficientCreditsError when deducting below zero', async () => {
    const { companyId } = await createEmployer(testDb)
    const { userId } = await createAdmin(testDb)
    await createWallet(companyId, 10)

    await expect(
      adminAdjust({ actorId: userId }, { companyId, delta: -20, note: 'correction' })
    ).rejects.toThrow(InsufficientCreditsError)
  })

  it('rejects an employer calling the service directly without changing wallet, ledger or audit', async () => {
    const { userId, companyId } = await createEmployer(testDb)
    const wallet = await createWallet(companyId, 10)

    await expect(adminAdjust({ actorId: userId }, { companyId, delta: 5, note: 'forbidden grant' }))
      .rejects.toBeInstanceOf(ForbiddenError)

    expect(await testDb.creditWallet.findUnique({ where: { id: wallet.id } })).toMatchObject({ balance: 10 })
    expect(await testDb.creditLedger.count({ where: { walletId: wallet.id } })).toBe(0)
    expect(await testDb.auditLog.count({ where: { action: 'credits.adjust', targetId: companyId } })).toBe(0)
  })

  it('rejects a suspended ADMIN without changing wallet, ledger or audit', async () => {
    const { companyId } = await createEmployer(testDb)
    const { userId } = await createAdmin(testDb)
    const wallet = await createWallet(companyId, 10)
    await testDb.user.update({ where: { id: userId }, data: { status: 'SUSPENDED' } })

    await expect(adminAdjust({ actorId: userId }, { companyId, delta: 5, note: 'suspended grant' }))
      .rejects.toBeInstanceOf(ForbiddenError)

    expect(await testDb.creditWallet.findUnique({ where: { id: wallet.id } })).toMatchObject({ balance: 10 })
    expect(await testDb.creditLedger.count({ where: { walletId: wallet.id } })).toBe(0)
    expect(await testDb.auditLog.count({ where: { action: 'credits.adjust', targetId: companyId } })).toBe(0)
  })

  it('rejects a missing actor without changing wallet, ledger or audit', async () => {
    const { companyId } = await createEmployer(testDb)
    const wallet = await createWallet(companyId, 10)

    await expect(adminAdjust({ actorId: 'missing-admin' }, { companyId, delta: 5, note: 'missing actor' }))
      .rejects.toBeInstanceOf(ForbiddenError)

    expect(await testDb.creditWallet.findUnique({ where: { id: wallet.id } })).toMatchObject({ balance: 10 })
    expect(await testDb.creditLedger.count({ where: { walletId: wallet.id } })).toBe(0)
    expect(await testDb.auditLog.count({ where: { action: 'credits.adjust', targetId: companyId } })).toBe(0)
  })

  it.each([0, 1.5, -1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, '5'])(
    'rejects invalid delta %s before writing funds or audit', async (delta) => {
      const { companyId } = await createEmployer(testDb)
      const { userId } = await createAdmin(testDb)
      const wallet = await createWallet(companyId, 10)

      await expect(adminAdjust({ actorId: userId }, { companyId, delta: delta as number, note: 'invalid delta' }))
        .rejects.toBeInstanceOf(ValidationError)

      expect(await testDb.creditWallet.findUnique({ where: { id: wallet.id } })).toMatchObject({ balance: 10 })
      expect(await testDb.creditLedger.count({ where: { walletId: wallet.id } })).toBe(0)
      expect(await testDb.auditLog.count({ where: { action: 'credits.adjust', targetId: companyId } })).toBe(0)
    },
  )

  it.each(['', ' \t\n '])('rejects a blank note %j before writing funds or audit', async (note) => {
    const { companyId } = await createEmployer(testDb)
    const { userId } = await createAdmin(testDb)
    const wallet = await createWallet(companyId, 10)

    await expect(adminAdjust({ actorId: userId }, { companyId, delta: 5, note }))
      .rejects.toBeInstanceOf(ValidationError)

    expect(await testDb.creditWallet.findUnique({ where: { id: wallet.id } })).toMatchObject({ balance: 10 })
    expect(await testDb.creditLedger.count({ where: { walletId: wallet.id } })).toBe(0)
    expect(await testDb.auditLog.count({ where: { action: 'credits.adjust', targetId: companyId } })).toBe(0)
  })
})

describe('CreditLedger and AuditLog append-only permissions', () => {
  function isPermissionDenied(err: unknown): boolean {
    if (!(err instanceof Error)) return false
    return err.message.includes('42501') || err.message.includes('permission denied for table')
  }

  it('UPDATE CreditLedger is denied (42501)', async () => {
    const { companyId } = await createEmployer(testDb)
    await createWallet(companyId, 0)
    const wallet = await testDb.creditWallet.findUniqueOrThrow({ where: { companyId } })
    // Insert a row first so the table is not empty
    await testDb.creditLedger.create({
      data: { walletId: wallet.id, delta: 1, balanceAfter: 1, reason: LedgerReason.PILOT_GRANT },
    })

    await expect(
      testDb.$executeRaw`UPDATE "CreditLedger" SET "delta" = 0`
    ).rejects.toSatisfy(isPermissionDenied)
  })

  it('DELETE CreditLedger is denied (42501)', async () => {
    const { companyId } = await createEmployer(testDb)
    await createWallet(companyId, 0)
    const wallet = await testDb.creditWallet.findUniqueOrThrow({ where: { companyId } })
    await testDb.creditLedger.create({
      data: { walletId: wallet.id, delta: 1, balanceAfter: 1, reason: LedgerReason.PILOT_GRANT },
    })

    await expect(
      testDb.$executeRaw`DELETE FROM "CreditLedger"`
    ).rejects.toSatisfy(isPermissionDenied)
  })

  it('UPDATE AuditLog is denied (42501)', async () => {
    await testDb.auditLog.create({ data: { action: 'test.perm', targetType: 'Test' } })

    await expect(
      testDb.$executeRaw`UPDATE "AuditLog" SET "action" = 'x'`
    ).rejects.toSatisfy(isPermissionDenied)
  })

  it('DELETE AuditLog is denied (42501)', async () => {
    await testDb.auditLog.create({ data: { action: 'test.perm2', targetType: 'Test' } })

    await expect(
      testDb.$executeRaw`DELETE FROM "AuditLog"`
    ).rejects.toSatisfy(isPermissionDenied)
  })
})

describe('reconcileWallet', () => {
  it('returns ok:true and 0/0 when wallet does not exist', async () => {
    const { companyId } = await createEmployer(testDb)
    const result = await reconcileWallet({ companyId })
    expect(result).toEqual({ ok: true, expected: 0, actual: 0 })
  })

  it('returns ok:true when balance matches ledger sum', async () => {
    const { companyId } = await createEmployer(testDb)
    const { userId } = await createAdmin(testDb)
    await createWallet(companyId, 0)

    await adminAdjust({ actorId: userId }, { companyId, delta: 100, note: 'grant' })
    await testDb.$transaction(async (tx) => {
      await applyLedgerEntry(tx, { companyId, delta: -20, reason: LedgerReason.UNLOCK })
    })

    const result = await reconcileWallet({ companyId })
    expect(result).toEqual({ ok: true, expected: 80, actual: 80 })
  })

  it('does not report a transient mismatch while ledger entries commit concurrently', async () => {
    const { companyId } = await createEmployer(testDb)
    await createWallet(companyId)

    const writeEntries = async () => {
      for (let index = 0; index < 30; index++) {
        await testDb.$transaction((tx) => applyLedgerEntry(tx, {
          companyId, delta: 1, reason: LedgerReason.PILOT_GRANT,
        }))
      }
    }
    const observeSnapshots = async () => {
      const observations = []
      for (let index = 0; index < 40; index++) {
        observations.push(await reconcileWallet({ companyId }))
      }
      return observations
    }

    const [, snapshots] = await Promise.all([writeEntries(), observeSnapshots()])
    expect(snapshots).toHaveLength(40)
    expect(snapshots.filter((snapshot) => !snapshot.ok || snapshot.expected !== snapshot.actual)).toEqual([])
    expect(await reconcileWallet({ companyId })).toEqual({ ok: true, expected: 30, actual: 30 })
  })

  it('reports a positive balance with no ledger rows as a mismatch', async () => {
    const { companyId } = await createEmployer(testDb)
    await createWallet(companyId, 25)

    expect(await reconcileWallet({ companyId })).toEqual({ ok: false, expected: 0, actual: 25 })
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
