import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Prisma } from '@prisma/client'

vi.mock('@/server/db', () => ({ db: { systemSetting: { findUnique: vi.fn() } } }))
import { db } from '@/server/db'
import { clearSettingsCache, getSetting } from '@/server/services/settings'

const lookup = vi.mocked(db.systemSetting.findUnique)
const row = (value: boolean) => ({ key: 'billing.enabled', value, updatedById: null, updatedAt: new Date() })

beforeEach(() => {
  lookup.mockReset()
  clearSettingsCache()
})

describe('fresh and transactional settings reads for billing', () => {
  it('fresh reads see sales close even when a cached value is true', async () => {
    lookup.mockResolvedValueOnce(row(true)).mockResolvedValueOnce(row(false))
    expect(await getSetting('billing.enabled', false)).toBe(true)
    expect(await getSetting('billing.enabled', false, { fresh: true })).toBe(false)
    expect(lookup).toHaveBeenCalledTimes(2)
  })

  it('uses the supplied transaction and never caches its uncommitted value', async () => {
    lookup.mockResolvedValueOnce(row(true))
    expect(await getSetting('billing.enabled', false)).toBe(true)
    const txLookup = vi.fn().mockResolvedValue(row(false))
    const tx = { systemSetting: { findUnique: txLookup } } as unknown as Prisma.TransactionClient
    expect(await getSetting('billing.enabled', false, { tx })).toBe(false)
    expect(txLookup).toHaveBeenCalledExactlyOnceWith({ where: { key: 'billing.enabled' } })
    expect(await getSetting('billing.enabled', false)).toBe(true)
    expect(lookup).toHaveBeenCalledTimes(1)
  })

  it('does not repopulate the cache with an old request after invalidation', async () => {
    let resolveOld!: (value: ReturnType<typeof row>) => void
    lookup.mockImplementationOnce(() => new Promise(resolve => { resolveOld = resolve }) as ReturnType<typeof db.systemSetting.findUnique>)
    const beforeChange = getSetting('billing.enabled', false)
    clearSettingsCache()
    resolveOld(row(true))
    expect(await beforeChange).toBe(true)
    lookup.mockResolvedValueOnce(row(false))
    expect(await getSetting('billing.enabled', false)).toBe(false)
    expect(lookup).toHaveBeenCalledTimes(2)
  })
})
