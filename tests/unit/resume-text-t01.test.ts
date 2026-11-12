import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const io = vi.hoisted(() => ({ spawn: vi.fn(), exists: vi.fn() }))
vi.mock('node:child_process', () => ({ spawn: io.spawn }))
vi.mock('node:fs', async original => ({ ...await original<typeof import('node:fs')>(), existsSync: io.exists }))

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}
function fakeChild() {
  const child = Object.assign(new EventEmitter(), {
    pid: 12345 as number | undefined,
    stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(),
    kill: vi.fn(() => true),
  })
  child.stdin.resume()
  return child
}
type FakeChild = ReturnType<typeof fakeChild>
const children: FakeChild[] = []
const pdf = Buffer.from('%PDF-1.7\nSYNTHETIC_ONLY')
const valid = { v: 1, ok: true, text: 'Synthetic career text', pageCount: 1 }
function close(child: FakeChild, code = 0, signal: NodeJS.Signals | null = null) {
  child.stdout.end()
  child.stderr.end()
  child.emit('close', code, signal)
}
async function begin(signal = new AbortController().signal, maxPages = 20, bytes = pdf) {
  const entered = deferred<FakeChild>()
  io.spawn.mockImplementationOnce(() => {
    const child = fakeChild()
    children.push(child)
    entered.resolve(child)
    return child as unknown as ChildProcessWithoutNullStreams
  })
  const extractor = await import('@/server/lib/resume-text')
  let done = false
  const result = extractor.extractResumeText(bytes, { maxPages, signal }).then(value => { done = true; return value })
  const child = await Promise.race([
    entered.promise,
    result.then(() => { throw new Error('Extractor settled before the child barrier') }),
  ])
  return { child, result, done: () => done }
}
beforeEach(() => {
  vi.resetModules()
  vi.resetAllMocks()
  io.exists.mockReturnValue(true)
})
afterEach(() => {
  for (const child of children.splice(0)) close(child, 1)
  vi.useRealTimers()
  vi.unstubAllEnvs()
})

describe('T01 PDF process supervisor', () => {
  it('requires actual close after valid JSON and uses a fixed secret-free child command', async () => {
    vi.stubEnv('NODE_OPTIONS', '--require synthetic-private-hook')
    vi.stubEnv('DATABASE_URL', 'synthetic-database-sentinel')
    vi.stubEnv('ANTHROPIC_API_KEY', 'synthetic-provider-sentinel')
    const task = await begin()
    try {
      task.child.stdout.write(JSON.stringify(valid))
      await Promise.resolve()
      expect(task.done()).toBe(false)
      const [binary, args, options] = io.spawn.mock.calls[0]
      expect(binary).toBe(process.execPath)
      expect(args).toEqual(['--max-old-space-size=128', expect.stringMatching(/src[/\\]server[/\\]lib[/\\]pdf-text-child\.mjs$/), '--max-pages', '20'])
      expect(options).toMatchObject({ shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
      expect(Object.keys(options.env).every(key => ['NODE_ENV', 'SystemRoot', 'WINDIR', 'TEMP', 'TMP'].includes(key))).toBe(true)
      expect(JSON.stringify(options.env)).not.toContain('sentinel')
      expect(options.env).not.toHaveProperty('NODE_OPTIONS')
    } finally { close(task.child) }
    expect(await task.result).toEqual({ ok: true, text: valid.text, pageCount: 1 })
  })

  it.each(['abort', 'timeout'] as const)('kills on %s but holds completion until close', async cause => {
    vi.useFakeTimers()
    const controller = new AbortController()
    const task = await begin(controller.signal)
    try {
      task.child.stdout.write(JSON.stringify(valid))
      if (cause === 'abort') controller.abort(new Error('PRIVATE_ABORT_SENTINEL'))
      else await vi.advanceTimersByTimeAsync(15_000)
      expect(task.child.kill).toHaveBeenCalledWith('SIGKILL')
      expect(task.done()).toBe(false)
    } finally { close(task.child, 1, 'SIGKILL') }
    expect(await task.result).toEqual({ ok: false, reason: cause === 'abort' ? 'aborted' : 'timeout' })
  })

  it('does not treat a failed kill request as child disposal', async () => {
    const controller = new AbortController()
    const task = await begin(controller.signal)
    task.child.kill.mockReturnValue(false)
    try {
      controller.abort()
      await Promise.resolve()
      expect(task.done()).toBe(false)
      expect(task.child.kill).toHaveBeenCalledOnce()
    } finally { close(task.child, 1) }
    expect(await task.result).toEqual({ ok: false, reason: 'aborted' })
  })

  it.each([
    ['nonzero', 1, null], ['signal', 0, 'SIGKILL'],
  ] as const)('rejects valid JSON followed by %s termination', async (_kind, code, signal) => {
    const task = await begin()
    task.child.stdout.write(JSON.stringify(valid))
    close(task.child, code, signal)
    expect(await task.result).toEqual({ ok: false, reason: 'child_failed' })
  })

  it.each([
    '', '{}', JSON.stringify(valid) + JSON.stringify(valid),
    JSON.stringify({ ...valid, secret: 'PRIVATE_SENTINEL' }),
    JSON.stringify({ ...valid, pageCount: 21 }),
    JSON.stringify({ ...valid, text: ' ' }),
    JSON.stringify({ ...valid, text: 'a'.repeat(100_001) }),
    JSON.stringify({ v: 1, ok: false, reason: 'PRIVATE_SENTINEL' }),
    Buffer.concat([Buffer.from('{"v":1,"ok":true,"pageCount":1,"text":"'), Buffer.from([255]), Buffer.from('"}')]),
  ])('rejects malformed or out-of-contract child output: %s', async body => {
    const task = await begin()
    task.child.stdout.write(body)
    close(task.child)
    expect(await task.result).toEqual({ ok: false, reason: 'protocol_error' })
  })

  it.each(['stdout', 'stderr'] as const)('bounds %s without exposing its content', async stream => {
    const task = await begin()
    try {
      task.child[stream].write(Buffer.alloc(stream === 'stdout' ? 1024 * 1024 + 1 : 64 * 1024 + 1, 65))
      expect(task.child.kill).toHaveBeenCalledWith('SIGKILL')
      expect(task.done()).toBe(false)
    } finally { close(task.child, 1) }
    expect(await task.result).toEqual({ ok: false, reason: 'output_limit' })
  })

  it.each(['encrypted', 'invalid', 'too_many_pages', 'text_limit', 'empty', 'failed'] as const)(
    'accepts only the fixed child failure %s', async reason => {
      const task = await begin()
      task.child.stdout.write(JSON.stringify({ v: 1, ok: false, reason }))
      close(task.child)
      expect(await task.result).toEqual({ ok: false, reason })
    },
  )

  it('sanitizes stdin failure and waits for the process to close', async () => {
    const task = await begin()
    try {
      task.child.stdin.emit('error', new Error('PRIVATE_STDIN_SENTINEL'))
      expect(task.child.kill).toHaveBeenCalledWith('SIGKILL')
      expect(task.done()).toBe(false)
    } finally { close(task.child, 1) }
    expect(await task.result).toEqual({ ok: false, reason: 'child_failed' })
  })

  it('rejects spawn failure without leaking its raw error', async () => {
    io.spawn.mockImplementationOnce(() => { throw new Error('PRIVATE_SPAWN_SENTINEL') })
    const { extractResumeText } = await import('@/server/lib/resume-text')
    expect(await extractResumeText(pdf, { maxPages: 20, signal: new AbortController().signal }))
      .toEqual({ ok: false, reason: 'child_failed' })
  })

  it('handles asynchronous ENOENT when no child was created', async () => {
    const task = await begin()
    task.child.pid = undefined
    task.child.emit('error', new Error('PRIVATE_ENOENT_SENTINEL'))
    expect(await task.result).toEqual({ ok: false, reason: 'child_failed' })
    expect(task.child.kill).not.toHaveBeenCalled()
  })

  it.each([0, 101, 1.5])('rejects invalid maxPages=%s before spawning', async maxPages => {
    const { extractResumeText } = await import('@/server/lib/resume-text')
    expect(await extractResumeText(pdf, { maxPages, signal: new AbortController().signal }))
      .toEqual({ ok: false, reason: 'invalid' })
    expect(io.spawn).not.toHaveBeenCalled()
  })

  it.each([0, 5 * 1024 * 1024 + 1])('rejects input of %s bytes before spawning', async size => {
    const { extractResumeText } = await import('@/server/lib/resume-text')
    expect(await extractResumeText(Buffer.alloc(size), { maxPages: 20, signal: new AbortController().signal }))
      .toEqual({ ok: false, reason: 'input_limit' })
    expect(io.spawn).not.toHaveBeenCalled()
  })

  it('does not spawn for an already aborted request or absent child entry', async () => {
    const { extractResumeText } = await import('@/server/lib/resume-text')
    const controller = new AbortController()
    controller.abort()
    expect(await extractResumeText(pdf, { maxPages: 20, signal: controller.signal })).toEqual({ ok: false, reason: 'aborted' })
    io.exists.mockReturnValueOnce(false)
    expect(await extractResumeText(pdf, { maxPages: 20, signal: new AbortController().signal })).toEqual({ ok: false, reason: 'child_failed' })
    expect(io.spawn).not.toHaveBeenCalled()
  })

  it('serializes direct calls and does not release the child slot on success JSON', async () => {
    const first = await begin()
    const { extractResumeText } = await import('@/server/lib/resume-text')
    const controller = new AbortController()
    const second = extractResumeText(pdf, { maxPages: 20, signal: controller.signal })
    try {
      first.child.stdout.write(JSON.stringify(valid))
      await Promise.resolve()
      expect(io.spawn).toHaveBeenCalledOnce()
      controller.abort()
      expect(await second).toEqual({ ok: false, reason: 'aborted' })
    } finally { controller.abort(); close(first.child) }
    expect(await first.result).toEqual({ ok: true, text: valid.text, pageCount: 1 })
    const recovered = await begin()
    recovered.child.stdout.write(JSON.stringify(valid))
    close(recovered.child)
    expect(await recovered.result).toEqual({ ok: true, text: valid.text, pageCount: 1 })
  })
})

describe('T01 storage/extraction admission', () => {
  it('releases admission after the storage/extractor callback rejects', async () => {
    const { withResumeTextSlot } = await import('@/server/lib/resume-text')
    await expect(withResumeTextSlot(async () => { throw new Error('SYNTHETIC_CALLBACK_FAILURE') }, {
      signal: new AbortController().signal,
    })).rejects.toThrow('SYNTHETIC_CALLBACK_FAILURE')
    expect(await withResumeTextSlot(async () => 'recovered', { signal: new AbortController().signal })).toBe('recovered')
  })

  it('waits before running queued work, aborts waiters, and releases after callback settlement', async () => {
    const { withResumeTextSlot } = await import('@/server/lib/resume-text')
    const entered = deferred<void>()
    const release = deferred<void>()
    const active = new AbortController()
    const waiting = new AbortController()
    const first = withResumeTextSlot(async signal => { entered.resolve(); await release.promise; return signal.aborted }, { signal: active.signal })
    await entered.promise
    const secondWork = vi.fn(async () => 'unreachable')
    const second = Promise.allSettled([withResumeTextSlot(secondWork, { signal: waiting.signal })])
    try {
      active.abort()
      await Promise.resolve()
      expect(secondWork).not.toHaveBeenCalled()
      waiting.abort(new Error('PRIVATE_WAIT_SENTINEL'))
      expect(await second).toMatchObject([{ status: 'rejected', reason: { name: 'AbortError', message: 'Resume text operation aborted' } }])
    } finally { waiting.abort(); release.resolve() }
    expect(await first).toBe(true)
    expect(await withResumeTextSlot(async () => 'recovered', { signal: new AbortController().signal })).toBe('recovered')
  })
})
