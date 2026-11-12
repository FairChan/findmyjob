vi.mock('@/server/services/settings', () => ({ getSetting: vi.fn().mockResolvedValue(5) }))
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Job, PgBoss } from 'pg-boss'

const io = vi.hoisted(() => ({
  parse: vi.fn(), dispatch: vi.fn(), recover: vi.fn(), capture: vi.fn(), ping: vi.fn(),
  info: vi.fn(), error: vi.fn(), close: vi.fn(), construct: vi.fn(), spawn: vi.fn(),
}))
vi.mock('@sentry/node', () => ({ init: vi.fn(), captureException: io.capture, close: io.close }))
vi.mock('pg-boss', () => ({ PgBoss: vi.fn(function (options: unknown) { return io.construct(options) }) }))
vi.mock('@/env', () => ({ env: { DATABASE_URL: 'postgresql://synthetic.invalid/test', APP_ENV: 'test' } }))
vi.mock('@/lib/sentry-options', () => ({ sentryOptions: {} }))
vi.mock('@/server/db', () => ({ db: { $executeRaw: vi.fn() } }))
vi.mock('@/server/lib/logger', () => ({ logger: { info: io.info, error: io.error, warn: vi.fn() } }))
vi.mock('@/server/lib/healthchecks', () => ({ pingHealthcheck: io.ping }))
vi.mock('@/server/jobs/parse-resume', () => ({ runResumeParse: io.parse }))
vi.mock('@/server/services/resume-parsing', () => ({ dispatchPendingResumeParses: io.dispatch }))
vi.mock('@/server/services/data-export-artifacts', () => ({ recoverDataExports: io.recover }))
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
vi.mock('node:child_process', () => ({ spawn: io.spawn }))
vi.mock('node:fs', async original => ({ ...await original<typeof import('node:fs')>(), existsSync: () => true }))

import { createJobLifecycle, registerJobs } from '@/server/jobs/registry'
import { extractResumeText, withResumeTextSlot } from '@/server/lib/resume-text'

type Payload = { resumeId: string; generation: number }
type Handler = (jobs: Job<Payload>[]) => Promise<void>
const payload = { resumeId: 'cmtestresume00000000000001', generation: 2 }
function job(signal = new AbortController().signal): Job<Payload> {
  return { id: 'synthetic-job', name: 'resume-parse', data: payload, signal,
    expireInSeconds: 900, heartbeatSeconds: null, retryCount: 0 }
}
function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
async function bounded<T>(work: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([work, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('Synthetic boundary did not settle')), 2000)
    })])
  } finally { clearTimeout(timer) }
}
function fakeBoss() {
  const handlers = new Map<string, Handler>()
  const boss = {
    on: vi.fn(), start: vi.fn().mockResolvedValue(undefined), stop: vi.fn().mockResolvedValue(undefined),
    createQueue: vi.fn().mockResolvedValue(undefined), schedule: vi.fn().mockResolvedValue(undefined),
    work: vi.fn(async (name: string, optionsOrHandler: unknown, handler?: Handler) => {
      handlers.set(name, (handler ?? optionsOrHandler) as Handler)
      return 'synthetic-worker'
    }),
  }
  return { boss, handlers }
}
function registeredHandler(handlers: Map<string, Handler>, name: string): Handler {
  const handler = handlers.get(name)
  expect(typeof handler, `Missing registered handler: ${name}`).toBe('function')
  return handler!
}
async function registration() {
  const state = fakeBoss(), lifecycle = createJobLifecycle()
  await registerJobs(state.boss as unknown as PgBoss, lifecycle)
  return { ...state, lifecycle }
}
function fakeChild() {
  return Object.assign(new EventEmitter(), {
    pid: 123, stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(),
    kill: vi.fn().mockReturnValue(true),
  })
}
function privateFailure() { return new Error('PRIVATE_PDF_AND_PROVIDER_BODY') }
function assertNoPrivateLogs() {
  const records = [...io.capture.mock.calls, ...io.info.mock.calls, ...io.error.mock.calls]
  expect(records.flatMap(args => args.map(value => value instanceof Error ? value.message + value.stack : JSON.stringify(value))).join('\n'))
    .not.toContain('PRIVATE_PDF_AND_PROVIDER_BODY')
}
beforeEach(() => {
  vi.clearAllMocks()
  io.parse.mockReset().mockResolvedValue(undefined)
  io.dispatch.mockReset().mockResolvedValue(undefined)
  io.recover.mockReset().mockResolvedValue(undefined)
  io.close.mockReset().mockResolvedValue(true)
  io.spawn.mockReset()
})
afterEach(() => vi.restoreAllMocks())

describe('T01 registry boundaries', () => {
  it('registers one parse consumer and independent minute recoveries without legacy cleanup', async () => {
    const { boss, lifecycle } = await registration()
    expect(boss.work).toHaveBeenCalledWith('resume-parse', { localConcurrency: 1, batchSize: 1 }, expect.any(Function))
    for (const name of ['dispatch-resume-parses', 'recover-data-exports']) {
      expect(boss.createQueue).toHaveBeenCalledWith(name)
      expect(boss.schedule).toHaveBeenCalledWith(name, '* * * * *', {}, { missed: 'once' })
      expect(boss.work).toHaveBeenCalledWith(name, { localConcurrency: 1, batchSize: 1 }, expect.any(Function))
    }
    expect(boss.schedule.mock.calls.some(call => /legacy/i.test(String(call[0])))).toBe(false)
    expect(boss.work.mock.calls.some(call => /legacy/i.test(String(call[0])))).toBe(false)
    expect(boss.schedule).toHaveBeenCalledWith('invoice-tasks', '* * * * *', {}, { tz: 'Asia/Kuala_Lumpur', missed: 'once' })
    await lifecycle.stop()
  })
  it('passes the exact payload and composed queue signal, and awaits the runner', async () => {
    const { handlers, lifecycle } = await registration(), held = deferred(), started = deferred<AbortSignal>()
    io.parse.mockImplementationOnce(async (_data: Payload, options: { signal: AbortSignal }) => {
      started.resolve(options.signal)
      await held.promise
    })
    const queued = new AbortController()
    let finished = false
    const running = registeredHandler(handlers, 'resume-parse')([job(queued.signal)]).then(() => { finished = true })
    try {
      const signal = await bounded(started.promise)
      expect(io.parse.mock.calls[0][0]).toBe(payload)
      expect(signal.aborted).toBe(false)
      queued.abort()
      expect(signal.aborted).toBe(true)
      expect(finished).toBe(false)
    } finally { held.resolve(); await running; await lifecycle.stop() }
  })
  it('does not admit an already-aborted queue attempt', async () => {
    const { handlers, lifecycle } = await registration(), queued = new AbortController()
    queued.abort()
    await registeredHandler(handlers, 'resume-parse')([job(queued.signal)])
    expect(io.parse).not.toHaveBeenCalled()
    await lifecycle.stop()
  })
  it('aborts in-flight work and refuses later admission until actual work settles', async () => {
    const { handlers, lifecycle } = await registration(), held = deferred(), started = deferred<AbortSignal>()
    io.parse.mockImplementationOnce(async (_data: Payload, options: { signal: AbortSignal }) => {
      started.resolve(options.signal)
      await held.promise
    })
    const running = registeredHandler(handlers, 'resume-parse')([job()])
    const signal = await bounded(started.promise)
    let stopped = false
    const stopping = lifecycle.stop().then(() => { stopped = true })
    try {
      expect(signal.aborted).toBe(true)
      await registeredHandler(handlers, 'resume-parse')([job()])
      expect(io.parse).toHaveBeenCalledOnce()
      expect(stopped).toBe(false)
    } finally { held.resolve(); await Promise.all([running, stopping]) }
  })
  it.each([
    ['resume-parse', 'RESUME_PARSE_JOB_FAILED'],
    ['dispatch-resume-parses', 'RESUME_PARSE_DISPATCH_FAILED'],
    ['recover-data-exports', 'DATA_EXPORT_RECOVERY_RETRY_REQUIRED'],
  ])('sanitizes unexpected errors from %s before Sentry and queue failure', async (name, code) => {
    const { handlers, lifecycle } = await registration()
    const operation = name === 'resume-parse' ? io.parse : name === 'dispatch-resume-parses' ? io.dispatch : io.recover
    operation.mockRejectedValueOnce(privateFailure())
    await expect(registeredHandler(handlers, name)([job()])).rejects.toThrow(code)
    expect(io.capture).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ message: code }))
    expect(io.ping).not.toHaveBeenCalled()
    assertNoPrivateLogs()
    await lifecycle.stop()
  })
  it.each(['dispatch-resume-parses', 'recover-data-exports'])('awaits %s independently before healthy completion', async name => {
    const { handlers, lifecycle } = await registration(), held = deferred(), started = deferred()
    const operation = name === 'dispatch-resume-parses' ? io.dispatch : io.recover
    operation.mockImplementationOnce(async () => { started.resolve(); await held.promise })
    let finished = false
    const running = registeredHandler(handlers, name)([]).then(() => { finished = true })
    try {
      await bounded(started.promise)
      expect(finished).toBe(false)
      expect(io.ping).not.toHaveBeenCalled()
      expect(name === 'dispatch-resume-parses' ? io.recover : io.dispatch).not.toHaveBeenCalled()
    } finally { held.resolve(); await running; await lifecycle.stop() }
    expect(io.ping).toHaveBeenCalledExactlyOnceWith(name)
  })
})

async function startWorker(state = fakeBoss(), readyQueue = 'purge-deleted-accounts') {
  vi.resetModules()
  const signals = new Map<string, () => void | Promise<void>>()
  const once = process.once.bind(process)
  vi.spyOn(process, 'once').mockImplementation((event, listener) => {
    if (event === 'SIGINT' || event === 'SIGTERM') { signals.set(event, listener as () => void | Promise<void>); return process }
    return once(event, listener)
  })
  const exit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)
  io.construct.mockReturnValue(state.boss)
  await import('@/worker')
  await vi.waitFor(() => {
    expect(state.handlers.has(readyQueue), `Missing registered handler: ${readyQueue}`).toBe(true)
    if (readyQueue === 'purge-deleted-accounts') expect(signals.has('SIGTERM')).toBe(true)
  })
  function signal(name: string): Promise<void> {
    const handler = signals.get(name)
    expect(typeof handler, `Missing signal handler: ${name}`).toBe('function')
    const stopping = Promise.resolve(handler!())
    // The old worker can reject on stop; observe immediately, assert its result
    // below instead of letting an unhandled rejection become the RED evidence.
    void stopping.catch(() => {})
    return stopping
  }
  return { ...state, signal, exit }
}
function holdRealChild() {
  const child = fakeChild(), started = deferred()
  io.spawn.mockReturnValue(child)
  io.parse.mockImplementationOnce(async (_data: Payload, options: { signal: AbortSignal }) => {
    await withResumeTextSlot(async signal => {
      const extracting = extractResumeText(Buffer.from('synthetic bytes'), { maxPages: 20, signal })
      // The real supervisor schedules spawn after taking its own real child slot.
      await vi.waitFor(() => expect(io.spawn).toHaveBeenCalledOnce())
      started.resolve()
      await extracting
    }, options)
  })
  return { child, started }
}

describe('T01 worker shutdown integration with real slot and child supervisor', () => {
  it('aborts before graceful stop and waits for actual close even when boss resolves immediately', async () => {
    const state = await startWorker(), { child, started } = holdRealChild()
    const running = registeredHandler(state.handlers, 'resume-parse')([job()])
    try {
      await bounded(started.promise)
      let killedBeforeStop = false
      state.boss.stop.mockImplementationOnce(async () => { killedBeforeStop = child.kill.mock.calls.some(args => args[0] === 'SIGKILL') })
      state.signal('SIGTERM')
      state.signal('SIGINT')
      await vi.waitFor(() => expect(state.boss.stop).toHaveBeenCalledOnce())
      expect(killedBeforeStop).toBe(true)
      expect(child.kill).toHaveBeenCalledWith('SIGKILL')
      expect(state.boss.stop).toHaveBeenCalledWith({ graceful: true })
      expect(state.exit).not.toHaveBeenCalled()
      expect(io.close).not.toHaveBeenCalled()
    } finally { child.emit('close', null, 'SIGKILL'); await running }
    await vi.waitFor(() => expect(state.exit).toHaveBeenCalledExactlyOnceWith(0))
    expect(io.close).toHaveBeenCalledExactlyOnceWith(2000)
  })
  it('keeps exit pending after child close until graceful stop and Sentry flush settle', async () => {
    const stop = deferred(), flush = deferred<boolean>(), state = fakeBoss()
    state.boss.stop.mockReturnValue(stop.promise)
    io.close.mockReturnValue(flush.promise)
    const worker = await startWorker(state), { child, started } = holdRealChild()
    const running = registeredHandler(worker.handlers, 'resume-parse')([job()])
    try {
      await bounded(started.promise)
      worker.signal('SIGTERM')
      child.emit('close', null, 'SIGKILL')
      await running
      expect(worker.exit).not.toHaveBeenCalled()
      expect(io.close).not.toHaveBeenCalled()
      stop.resolve()
      await vi.waitFor(() => expect(io.close).toHaveBeenCalledOnce())
      expect(worker.exit).not.toHaveBeenCalled()
    } finally { child.emit('close', null, 'SIGKILL'); stop.resolve(); flush.resolve(true); await running }
    await vi.waitFor(() => expect(worker.exit).toHaveBeenCalledExactlyOnceWith(0))
  })
  it('waits for actual child close even when boss stop rejects, and reports only a fixed failure', async () => {
    const state = await startWorker(), { child, started } = holdRealChild()
    state.boss.stop.mockRejectedValueOnce(privateFailure())
    const running = registeredHandler(state.handlers, 'resume-parse')([job()])
    let stopping: Promise<void> | undefined
    try {
      await bounded(started.promise)
      stopping = state.signal('SIGTERM')
      await vi.waitFor(() => expect(state.boss.stop).toHaveBeenCalledOnce())
      expect(state.exit).not.toHaveBeenCalled()
    } finally { child.emit('close', null, 'SIGKILL'); await running }
    await expect(stopping).resolves.toBeUndefined()
    await vi.waitFor(() => expect(state.exit).toHaveBeenCalledExactlyOnceWith(1))
    expect(io.capture).toHaveBeenCalledWith(expect.objectContaining({ message: 'WORKER_SHUTDOWN_FAILED' }))
    assertNoPrivateLogs()
  })
  it('drains an already-started child if later registry startup fails', async () => {
    const registration = deferred(), state = fakeBoss()
    state.boss.createQueue.mockImplementation(async (name: string) => {
      if (name === 'dispatch-resume-parses') await registration.promise
    })
    const worker = await startWorker(state, 'resume-parse'), { child, started } = holdRealChild()
    const running = registeredHandler(worker.handlers, 'resume-parse')([job()])
    try {
      await bounded(started.promise)
      registration.reject(privateFailure())
      await vi.waitFor(() => expect(child.kill).toHaveBeenCalledWith('SIGKILL'))
      expect(worker.exit).not.toHaveBeenCalled()
    } finally { registration.resolve(); child.emit('close', null, 'SIGKILL'); await running }
    await vi.waitFor(() => expect(worker.exit).toHaveBeenCalledExactlyOnceWith(1))
    expect(io.capture).toHaveBeenCalledWith(expect.objectContaining({ message: 'WORKER_STARTUP_FAILED' }))
    assertNoPrivateLogs()
  })
  it('also drains an in-flight export recovery when boss stop returns before that task', async () => {
    const state = await startWorker(), held = deferred(), started = deferred()
    io.recover.mockImplementationOnce(async () => { started.resolve(); await held.promise })
    const running = registeredHandler(state.handlers, 'recover-data-exports')([])
    try {
      await bounded(started.promise)
      state.signal('SIGTERM')
      await vi.waitFor(() => expect(state.boss.stop).toHaveBeenCalledOnce())
      expect(state.exit).not.toHaveBeenCalled()
    } finally { held.resolve(); await bounded(running) }
    await vi.waitFor(() => expect(state.exit).toHaveBeenCalledExactlyOnceWith(0))
  })
})
