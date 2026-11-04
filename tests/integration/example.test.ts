/**
 * Example integration test.
 *
 * Verifies:
 * - DB setup / safety check works (this file throws at import if DB is wrong)
 * - Factories produce consistent, deterministic output
 * - A PrismaClient with connection_limit=12 can run 5 concurrent pg_sleep(0.2)
 *   queries in under 0.6 seconds (self-check for connection-pool parallelism)
 */
import { describe, it, expect } from 'vitest'
import { PrismaClient } from '@prisma/client'
import { setupTestDb, testDb } from '../setup/db'
import { createStudent, faker, FAKER_SEED } from '../factories'

setupTestDb()

describe('DB setup', () => {
  it('inserts and retrieves a user', async () => {
    const { userId, name, email } = await createStudent(testDb)
    const user = await testDb.user.findUniqueOrThrow({ where: { id: userId } })
    expect(user.name).toBe(name)
    expect(user.email).toBe(email)
  })
})

describe('factories', () => {
  it('produces the same first student when seed is reset', async () => {
    faker.seed(FAKER_SEED)
    const a = await createStudent(testDb)

    // Clear and reset seed
    await testDb.user.deleteMany()
    faker.seed(FAKER_SEED)
    const b = await createStudent(testDb)

    expect(a.name).toBe(b.name)
    expect(a.email).toBe(b.email)
  })
})

describe('connection-pool self-check', () => {
  it('runs 5 concurrent pg_sleep(0.2) in under 600 ms (connection_limit=12)', async () => {
    const url = new URL(
      process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL ?? ''
    )
    url.searchParams.set('connection_limit', '12')

    const parallelClient = new PrismaClient({
      datasources: { db: { url: url.toString() } },
      log: [],
    })

    try {
      const start = Date.now()
      await Promise.all(
        Array.from({ length: 5 }, () =>
          parallelClient.$queryRaw`SELECT pg_sleep(0.2)::text AS slept`
        )
      )
      const elapsed = Date.now() - start
      // With 12 connections all 5 run in parallel (≈ 200 ms).
      // With connection_limit=1 they'd be serial (≈ 1000 ms).
      expect(elapsed).toBeLessThan(600)
    } finally {
      await parallelClient.$disconnect()
    }
  })
})
