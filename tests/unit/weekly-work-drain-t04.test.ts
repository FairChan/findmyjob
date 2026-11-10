import { afterEach, beforeEach, expect, it, vi } from 'vitest'
const io = vi.hoisted(() => ({ users: vi.fn(), send: vi.fn(), start: vi.fn() }))
vi.mock('@/server/db', () => ({ db: {
  user: { findMany: io.users },
  $transaction: async (work: (tx: unknown) => unknown) => work({ weeklyDigestDelivery: {
    createMany: vi.fn().mockResolvedValue({ count: 1 }),
    findUniqueOrThrow: vi.fn().mockResolvedValue({ id: 'c' + '1'.repeat(24) }),
  } }),
} }))
vi.mock('@/server/lib/advisory-locks', () => ({ lockXact: vi.fn(), LOCK_NS: { MARKETING: 1010 } }))
vi.mock('@/server/jobs/boss', () => ({ sendBoss: { start: io.start, send: io.send } }))
vi.mock('@/server/services/semantic-matching', () => ({ recommendJobs: vi.fn(), recommendTalents: vi.fn() }))
vi.mock('@/server/services/notify', () => ({ sendWeeklyDigestEmail: vi.fn() }))
vi.mock('@/server/services/weekly-digest-data', () => ({ loadWeeklyContextTx: vi.fn().mockResolvedValue({}), contextMetadata: () => ({}), contextMatches: vi.fn() }))
import { scheduleWeeklyDigests, drainWeeklyDigestWork } from '@/server/jobs/weekly-digest'
afterEach(() => vi.useRealTimers())
beforeEach(() => { io.users.mockReset().mockResolvedValue([]); io.send.mockReset(); io.start.mockReset() })
it('keeps actual queue I/O owned after the two-second result deadline', async () => {
  vi.useFakeTimers()
  let release!: (id: string) => void
  const held = new Promise<string>(resolve => { release = resolve })
  io.users.mockResolvedValueOnce([{ id: 'synthetic-user', role: 'STUDENT' }]).mockResolvedValueOnce([])
  io.send.mockReturnValueOnce(held)
  const scheduled = scheduleWeeklyDigests()
  await vi.advanceTimersByTimeAsync(2_001)
  await expect(scheduled).resolves.toMatchObject({ queued: 1 })
  let drained = false
  const drain = drainWeeklyDigestWork().then(() => { drained = true })
  await Promise.resolve()
  expect(drained).toBe(false)
  release('synthetic-job')
  await drain
  expect(drained).toBe(true)
})
it('registry port waits for pending send after abort and does not start the next recipient', async () => {
  let release!: (id: string) => void, entered!: () => void
  const held = new Promise<string>(resolve => { release = resolve })
  const started = new Promise<void>(resolve => { entered = resolve })
  const controller = new AbortController()
  const send = vi.fn(async () => { entered(); return held })
  io.users.mockResolvedValueOnce([{ id: 'synthetic-one', role: 'STUDENT' }, { id: 'synthetic-two', role: 'STUDENT' }])
  let settled = false
  const pending = scheduleWeeklyDigests({ signal: controller.signal, send }).then(result => { settled = true; return result })
  await Promise.race([started, pending])
  expect(send).toHaveBeenCalledOnce()
  controller.abort()
  await Promise.resolve()
  expect(settled).toBe(false)
  expect(io.start).not.toHaveBeenCalled(); expect(io.send).not.toHaveBeenCalled()
  release('synthetic-job')
  await expect(pending).resolves.toMatchObject({ queued: 1 })
  expect(send).toHaveBeenCalledExactlyOnceWith({ deliveryId: 'c' + '1'.repeat(24) })
})
