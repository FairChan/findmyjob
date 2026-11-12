import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { setTimeout as realSetTimeout, clearTimeout as realClearTimeout } from 'node:timers'
import type { Job, PgBoss } from 'pg-boss'
const ports = vi.hoisted(() => ({ transactions: 0, write: vi.fn(), capture: vi.fn() }))
vi.mock('@/server/db', async () => {
  const { testDb } = await import('../setup/db')
  return { db: new Proxy(testDb, { get(target, key, receiver) {
    if (key === '$transaction') return (...args: unknown[]) => {
      ports.transactions++
      return Reflect.apply(target.$transaction, target, args)
    }
    return Reflect.get(target, key, receiver)
  } }) }
})
vi.mock('@/env', () => ({ env: { VOYAGE_API_KEY: 'synthetic-key', AI_MODEL_EMBED: 'synthetic-embedding-model' } }))
vi.mock('@/server/jobs/boss', () => ({ sendBoss: { start: vi.fn(), send: vi.fn().mockResolvedValue('synthetic') } }))
vi.mock('@/server/lib/semantic-store', () => ({ isSemanticStoreAvailable: vi.fn().mockResolvedValue(true),
  writeSemanticVector: ports.write, deleteSemanticVector: vi.fn(), findTalentNeighbors: vi.fn(), findJobNeighbors: vi.fn() }))
vi.mock('@/server/lib/logger', () => ({ logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } }))
vi.mock('@/server/lib/healthchecks', () => ({ pingHealthcheck: vi.fn() }))
vi.mock('@sentry/node', () => ({ captureException: ports.capture }))
vi.mock('@/server/jobs/purge-unverified', () => ({ runPurgeUnverified: vi.fn() }))
vi.mock('@/server/jobs/requalify-referrals', () => ({ runRequalifyReferrals: vi.fn() }))
vi.mock('@/server/jobs/pilot-monthly-credits', () => ({ runPilotMonthlyCredits: vi.fn() }))
vi.mock('@/server/jobs/reconcile-wallets', () => ({ runReconcileWallets: vi.fn() }))
vi.mock('@/server/jobs/expire-invitations', () => ({ runExpireInvitations: vi.fn() }))
vi.mock('@/server/jobs/expire-subscriptions', () => ({ runExpireSubscriptions: vi.fn() }))
vi.mock('@/server/jobs/invoice-tasks', () => ({ runInvoiceTasks: vi.fn() }))
vi.mock('@/server/jobs/employer-daily-digest', () => ({ runEmployerDailyDigest: vi.fn() }))
vi.mock('@/server/jobs/export-user-data', () => ({ runExportUserData: vi.fn() }))
vi.mock('@/server/jobs/purge-deleted-accounts', () => ({ runPurgeDeletedAccounts: vi.fn() }))
// The index runner, embedding adapter, matching service and lifecycle remain real.
import { setupTestDb, testDb } from '../setup/db'
import { createJobLifecycle, registerJobs } from '@/server/jobs/registry'
import { requestStudentMatchingIndex } from '@/server/services/semantic-matching'
import { clearSettingsCache } from '@/server/services/settings'
import { seedT03Gate, t03Student } from '../helpers/semantic-matching-t03'
setupTestDb()
async function realBounded<T>(promise: Promise<T>): Promise<T> {
  let timer!: ReturnType<typeof realSetTimeout>
  try {
    return await Promise.race([promise, new Promise<never>((_, reject) => {
      timer = realSetTimeout(() => reject(new Error('Synthetic transport boundary was not reached')), 5_000)
    })])
  } finally { realClearTimeout(timer) }
}
function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  const promise = new Promise<T>(yes => { resolve = yes })
  return { promise, resolve }
}
function pendingBody() {
  const read = deferred<void>(), cancelled = deferred<void>(), cleanup = deferred<void>()
  const cancel = vi.fn(() => { cancelled.resolve(); return cleanup.promise })
  const body = new ReadableStream<Uint8Array>({ pull() { read.resolve() }, cancel }, { highWaterMark: 0 })
  return { body, read, cancelled, cleanup, cancel }
}
beforeEach(() => { vi.clearAllMocks(); clearSettingsCache(); ports.transactions = 0 })
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })
describe('T03-R2 real runner → real adapter → pending transport cleanup → lifecycle drain', () => {
  it.each(['shutdown', 'adapter-timeout'] as const)('retains the real provider tail after %s', async reason => {
    await seedT03Gate(); const student = await t03Student()
    const payload = await requestStudentMatchingIndex({ userId: student.userId })
    const lifecycle = createJobLifecycle(), handlers = new Map<string, (jobs: Job[]) => Promise<void>>()
    const boss = { createQueue: vi.fn(), schedule: vi.fn(), send: vi.fn(), work: vi.fn(async (name: string, options: unknown, handler?: (jobs: Job[]) => Promise<void>) => {
      handlers.set(name, (handler ?? options) as (jobs: Job[]) => Promise<void>)
    }) }
    await registerJobs(boss as unknown as PgBoss, lifecycle)
    const stream = pendingBody()
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(stream.body, { headers: { 'content-type': 'application/json' } }))
    vi.stubGlobal('fetch', fetchMock)
    // Date stays real so the DB lease clock is not advanced by the synthetic transport timer.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    let finished = false, stopped = false
    const job = { id: 'synthetic-queue-job', name: 'matching-index', data: payload, signal: new AbortController().signal } as Job
    const running = handlers.get('matching-index')!([job]).then(() => { finished = true })
    let stopping: Promise<void> | undefined
    try {
      await realBounded(stream.read.promise)
      expect(fetchMock).toHaveBeenCalledOnce()
      const beforeAbortTransactions = ports.transactions
      if (reason === 'adapter-timeout') await vi.advanceTimersByTimeAsync(20_000)
      stopping = lifecycle.stop().then(() => { stopped = true })
      await realBounded(stream.cancelled.promise)
      await vi.advanceTimersByTimeAsync(1)
      expect(fetchMock.mock.calls[0][1]?.signal?.aborted).toBe(true)
      expect(stream.cancel).toHaveBeenCalledOnce()
      expect(finished).toBe(false)
      expect(stopped).toBe(false)
      // The transparent proxy delegates every actual DB transaction unchanged.
      // An early worker fail transaction proves the baseline detached the real tail,
      // even if that transaction has not yet completed its own network round trip.
      expect(ports.transactions).toBe(beforeAbortTransactions)
      expect((await testDb.semanticIndex.findUniqueOrThrow({ where: { id: payload.indexId } })).state).toBe('PROCESSING')
      expect(ports.write).not.toHaveBeenCalled()
      stream.cleanup.resolve()
      await realBounded(Promise.all([running, stopping]))
      expect(finished).toBe(true)
      expect(stopped).toBe(true)
      expect(await testDb.semanticIndex.findUniqueOrThrow({ where: { id: payload.indexId } })).toMatchObject({ state: 'QUEUED', attempts: 1, leaseToken: null, failureCode: 'PROVIDER_TIMEOUT' })
      expect(ports.write).not.toHaveBeenCalled()
      expect(ports.capture).not.toHaveBeenCalled()
    } finally {
      stream.cleanup.resolve()
      await realBounded(Promise.allSettled([running, stopping ?? lifecycle.stop()]))
    }
  })
})
