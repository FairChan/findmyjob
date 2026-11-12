import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Prisma, PrismaClient } from '@prisma/client'
import { setupTestDb, testDb } from '../setup/db'

const mocks = vi.hoisted(() => ({ warn: vi.fn(), cachedSetting: vi.fn() }))
vi.mock('@/server/lib/logger', () => ({
  logger: { warn: mocks.warn, error: vi.fn(), info: vi.fn() },
}))
// Deliberately stale cache: read capacity inside the locked transaction.
vi.mock('@/server/services/settings', () => ({ getSetting: mocks.cachedSetting }))

setupTestDb()
const peerDb = new PrismaClient({
  datasources: { db: { url: process.env.TEST_DATABASE_URL } },
  log: [],
})
const SCOPE = 'resume-watermark'
const SETTING = 'resume.watermarkGlobalConcurrency'
type Service = typeof import('@/server/services/watermark-lease')
type Lease = NonNullable<Awaited<ReturnType<Service['acquireWatermarkLease']>>>
let serviceA: Service
let serviceB: Service

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(res => { resolve = res })
  return { promise, resolve }
}

beforeEach(async () => {
  mocks.warn.mockReset()
  mocks.cachedSetting.mockReset().mockResolvedValue(4)
  // Independent module instances and connection pools; real locks and rows.
  vi.resetModules()
  vi.doMock('@/server/db', () => ({ db: testDb }))
  serviceA = await import('@/server/services/watermark-lease')
  vi.resetModules()
  vi.doMock('@/server/db', () => ({ db: peerDb }))
  serviceB = await import('@/server/services/watermark-lease')
})

afterEach(() => {
  vi.useRealTimers()
  vi.doUnmock('@/server/db')
})
afterAll(async () => { await peerDb.$disconnect() })

async function setCapacity(value: Prisma.InputJsonValue) {
  await testDb.systemSetting.upsert({
    where: { key: SETTING },
    create: { key: SETTING, value },
    update: { value },
  })
}

async function acquireRequired(ownerKey: string): Promise<Lease> {
  const lease = await serviceA.acquireWatermarkLease(ownerKey)
  expect(lease).not.toBeNull()
  if (!lease) throw new Error('Expected a watermark lease')
  return lease
}

async function activeRows() {
  return testDb.$queryRaw<{ id: string; ownerKey: string; expiresAt: Date }[]>`
    SELECT "id", "ownerKey", "expiresAt" FROM "ConcurrencyLease"
    WHERE "scope" = ${SCOPE} AND "expiresAt" > clock_timestamp()
  `
}

describe('database watermark leases (M4-T17)', () => {
  it('admits only four simultaneous requests across independent service instances', async () => {
    const results = await Promise.all(Array.from({ length: 16 }, (_, index) =>
      (index % 2 ? serviceA : serviceB).acquireWatermarkLease('member-' + index),
    ))

    expect(results.filter(Boolean)).toHaveLength(4)
    expect(await activeRows()).toHaveLength(4)
    expect(new Set(results.filter((lease): lease is Lease => lease !== null).map(lease => lease.id)).size)
      .toBe(4)
  })

  it('admits at most two simultaneous requests for the same member across instances', async () => {
    const results = await Promise.all(Array.from({ length: 10 }, (_, index) =>
      (index % 2 ? serviceA : serviceB).acquireWatermarkLease('same-member'),
    ))

    expect(results.filter(Boolean)).toHaveLength(2)
    expect(await activeRows()).toHaveLength(2)
    expect(await serviceB.acquireWatermarkLease('another-member')).not.toBeNull()
  })

  it('uses configured database capacity despite a stale process setting cache', async () => {
    await setCapacity(2)
    const results = await Promise.all(Array.from({ length: 8 }, (_, index) =>
      (index % 2 ? serviceA : serviceB).acquireWatermarkLease('member-' + index),
    ))

    expect(results.filter(Boolean)).toHaveLength(2)
    expect(await activeRows()).toHaveLength(2)
  })

  it.each([0, -1, 1.5, '8', 'invalid', false, {}, []].map(value => ({ value })))(
    'falls back to four and warns for invalid capacity %j',
    async ({ value }) => {
      await setCapacity(value)
      const results = await Promise.all(Array.from({ length: 6 }, (_, index) =>
        (index % 2 ? serviceA : serviceB).acquireWatermarkLease('member-' + index),
      ))

      expect(results.filter(Boolean)).toHaveLength(4)
      expect(await activeRows()).toHaveLength(4)
      expect(mocks.warn).toHaveBeenCalled()
    },
  )

  it('uses the database clock when the application clock is wrong', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2099-01-01T00:00:00Z'))
    const lease = await acquireRequired('member-clock')
    const [row] = await testDb.$queryRaw<{ remainingMs: number }[]>`
      SELECT (EXTRACT(EPOCH FROM ("expiresAt" - clock_timestamp())) * 1000)::float8 AS "remainingMs"
      FROM "ConcurrencyLease" WHERE "id" = ${lease.id}
    `

    expect(row.remainingMs).toBeGreaterThan(30_000)
    expect(row.remainingMs).toBeLessThanOrEqual(120_000)
  })

  it('reads database time after waiting for the scope lock', async () => {
    await setCapacity(1)
    const locked = deferred<void>()
    const unlock = deferred<void>()
    const blocker = testDb.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(1006::int, hashtext(${SCOPE})::int)`
      await tx.concurrencyLease.create({
        data: {
          id: 'expiring-under-lock',
          scope: SCOPE,
          ownerKey: 'old-member',
          expiresAt: new Date('2099-01-01T00:00:00Z'),
        },
      })
      locked.resolve()
      await unlock.promise
      // Later than the waiting transaction's start timestamp.
      await tx.$executeRaw`
        UPDATE "ConcurrencyLease" SET "expiresAt" = clock_timestamp() - interval '1 millisecond'
        WHERE "id" = 'expiring-under-lock'
      `
    }, { timeout: 10_000 })
    await Promise.race([locked.promise, blocker])
    const acquiring = serviceB.acquireWatermarkLease('new-member')
      .then(value => ({ ok: true, value }), error => ({ ok: false, error }))

    try {
      await vi.waitFor(async () => {
        const [row] = await testDb.$queryRaw<{ waiting: number }[]>`
          SELECT count(*)::int AS waiting FROM pg_locks
          WHERE locktype = 'advisory' AND NOT granted AND classid = 1006::oid
        `
        expect(row.waiting).toBeGreaterThan(0)
      }, { timeout: 3000, interval: 20 })
    } finally {
      unlock.resolve()
      await blocker
      await acquiring
    }

    expect(await acquiring).toMatchObject({ ok: true, value: expect.objectContaining({ scope: SCOPE }) })
    expect(await activeRows()).toHaveLength(1)
  })

  it('reclaims expired capacity without reviving the old lease', async () => {
    await setCapacity(1)
    const expired = await acquireRequired('member-old')
    await testDb.$executeRaw`
      UPDATE "ConcurrencyLease" SET "expiresAt" = clock_timestamp() - interval '1 second'
      WHERE "id" = ${expired.id}
    `

    expect(await serviceB.renewWatermarkLease(expired)).toBe(false)
    const replacement = await serviceB.acquireWatermarkLease('member-new')
    expect(replacement).not.toBeNull()
    if (!replacement) throw new Error('Expired capacity was not reclaimed')
    expect(replacement.id).not.toBe(expired.id)
    expect(await serviceA.renewWatermarkLease(expired)).toBe(false)
    await serviceA.releaseWatermarkLease(expired)
    expect((await activeRows()).map(row => row.id)).toEqual([replacement.id])
  })

  it('extends a live matching lease using database time', async () => {
    const lease = await acquireRequired('member-renew')
    await testDb.$executeRaw`
      UPDATE "ConcurrencyLease" SET "expiresAt" = clock_timestamp() + interval '10 seconds'
      WHERE "id" = ${lease.id}
    `
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2000-01-01T00:00:00Z'))

    expect(await serviceB.renewWatermarkLease(lease)).toBe(true)
    const [row] = await testDb.$queryRaw<{ remainingMs: number }[]>`
      SELECT (EXTRACT(EPOCH FROM ("expiresAt" - clock_timestamp())) * 1000)::float8 AS "remainingMs"
      FROM "ConcurrencyLease" WHERE "id" = ${lease.id}
    `
    expect(row.remainingMs).toBeGreaterThan(30_000)
    expect(row.remainingMs).toBeLessThanOrEqual(120_000)
  })

  it('does not renew or release a lease using another owner or scope', async () => {
    const lease = await acquireRequired('member-owner')
    for (const forged of [
      { ...lease, ownerKey: 'other-member' },
      { ...lease, scope: 'other-scope' },
    ]) {
      expect(await serviceB.renewWatermarkLease(forged as Lease)).toBe(false)
      await serviceB.releaseWatermarkLease(forged as Lease)
      expect((await activeRows()).map(row => row.id)).toEqual([lease.id])
    }
  })

  it('releases idempotently and makes capacity immediately reusable', async () => {
    await setCapacity(1)
    const lease = await acquireRequired('member-release')
    expect(await serviceB.acquireWatermarkLease('waiting-member')).toBeNull()

    await serviceA.releaseWatermarkLease(lease)
    await serviceB.releaseWatermarkLease(lease)

    expect(await activeRows()).toHaveLength(0)
    expect(await serviceA.renewWatermarkLease(lease)).toBe(false)
    expect(await serviceB.acquireWatermarkLease('waiting-member')).not.toBeNull()
  })
})
