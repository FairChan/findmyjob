import { describe, expect, it, vi } from 'vitest'
import type { Prisma } from '@prisma/client'
vi.mock('@/server/db', () => ({ db: {} }))
vi.mock('@/server/lib/matching-config', () => ({ getMatchingConfiguration: vi.fn() }))
vi.mock('@/server/services/settings', () => ({ getSetting: vi.fn() }))
import { deleteSemanticVector } from '@/server/lib/semantic-store'
describe('T03-R1 physical deletion never silently succeeds without optional capability', () => {
  it('throws a controlled unavailable result without executing vector SQL', async () => {
    const tx = { $queryRaw: vi.fn().mockResolvedValue([{ available: false }]), $executeRaw: vi.fn() }
    await expect(deleteSemanticVector(tx as unknown as Prisma.TransactionClient, 'c' + '1'.repeat(24))).rejects.toMatchObject({ code: 'SEMANTIC_STORE_UNAVAILABLE' })
    expect(tx.$executeRaw).not.toHaveBeenCalled()
  })
  it('treats an available zero-row DELETE as a successful idempotent probe', async () => {
    const tx = { $queryRaw: vi.fn().mockResolvedValue([{ available: true }]), $executeRaw: vi.fn().mockResolvedValue(0) }
    await expect(deleteSemanticVector(tx as unknown as Prisma.TransactionClient, 'c' + '1'.repeat(24))).resolves.toBeUndefined()
    expect(tx.$executeRaw).toHaveBeenCalledOnce()
  })
})
