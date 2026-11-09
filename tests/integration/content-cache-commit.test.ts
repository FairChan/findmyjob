import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/server/auth', () => ({ getSession: vi.fn(), auth: {} }))
const commitGate = vi.hoisted(() => ({
  pause: undefined as (() => Promise<void>) | undefined,
}))
vi.mock('@/server/db', async () => {
  const { testDb } = await import('../setup/db')
  // Keep real DB operations, but hold the transaction after the service callback returns.
  // This catches invalidation anywhere inside the callback, including after its audit write.
  return {
    db: new Proxy(testDb, {
      get(target, property, receiver) {
        if (property === '$transaction') {
          return (
            work: (tx: import('@prisma/client').Prisma.TransactionClient) => Promise<unknown>,
            options?: Parameters<typeof testDb.$transaction>[1],
          ) => target.$transaction(async (tx) => {
            const result = await work(tx)
            await commitGate.pause?.()
            return result
          }, options)
        }
        const value = Reflect.get(target, property, receiver)
        return typeof value === 'function' ? value.bind(target) : value
      },
    }),
  }
})
vi.mock('next/headers', () => ({ headers: vi.fn().mockResolvedValue(new Headers()) }))

import { setupTestDb, testDb } from '../setup/db'
import { createAdmin, createEmployer } from '../factories'
import { saveSynonymGroup } from '@/server/services/search-synonyms'
import { _clearSynonymCache, searchJobs } from '@/server/services/job-search'
import { clearSettingsCache } from '@/server/services/settings'

setupTestDb()
beforeEach(() => {
  commitGate.pause = undefined
  _clearSynonymCache()
  clearSettingsCache()
})
afterEach(() => {
  commitGate.pause = undefined
  _clearSynonymCache()
  clearSettingsCache()
})

function signal() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => { resolve = done })
  return { promise, resolve }
}

async function relatedIds() {
  const result = await searchJobs({ q: 'cobaltdesk', mode: 'RELATED' })
  return [...result.exact, ...result.related].map((hit) => hit.job.id)
}

describe('synonym cache and transaction commit', () => {
  it('invalidates after commit even when a concurrent search runs before commit', async () => {
    const ctx = await createAdmin(testDb)
    const employer = await createEmployer(testDb, { legalName: 'Synthetic Commit Search Employer' })
    const job = await testDb.job.create({
      data: {
        companyId: employer.companyId, createdById: employer.userId, title: '琥珀岗位',
        description: 'Synthetic description', status: 'PUBLISHED', type: 'INTERNSHIP',
        workMode: 'HYBRID', publishedAt: new Date(),
      },
    })
    const group = await testDb.searchSynonymGroup.create({
      data: { terms: ['cobaltdesk', 'violetdesk'], active: true },
    })
    expect(await relatedIds()).toEqual([])

    const reachedCommit = signal()
    const releaseCommit = signal()
    commitGate.pause = () => {
      reachedCommit.resolve()
      return releaseCommit.promise
    }
    const saving = saveSynonymGroup(ctx, {
      id: group.id, terms: ['cobaltdesk', '琥珀岗位'], active: true,
    })
    // Attach a rejection handler immediately so an unimplemented service cannot hang this test.
    const settled = saving.then(
      (value) => ({ kind: 'saved' as const, value }),
      (error: unknown) => ({ kind: 'failed' as const, error }),
    )
    try {
      const first = await Promise.race([
        reachedCommit.promise.then(() => ({ kind: 'held' as const })),
        settled,
      ])
      expect(first.kind).toBe('held')
      // The held transaction has not committed; neither data nor cache may expose its new term.
      expect(await relatedIds()).toEqual([])
    } finally {
      releaseCommit.resolve()
      commitGate.pause = undefined
      await settled
    }

    expect((await settled).kind).toBe('saved')
    // If invalidation ran only before commit, the intervening search may have cached old rows.
    expect(await relatedIds()).toEqual([job.id])
  })
})
