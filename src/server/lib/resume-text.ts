import 'server-only'
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'

export type ResumeTextFailure =
  | 'encrypted' | 'invalid' | 'too_many_pages' | 'text_limit' | 'empty' | 'failed'
  | 'input_limit' | 'timeout' | 'aborted' | 'output_limit' | 'protocol_error' | 'child_failed'

export type ResumeTextResult =
  | { ok: true; text: string; pageCount: number }
  | { ok: false; reason: ResumeTextFailure }

const MAX_INPUT_BYTES = 5 * 1024 * 1024
const MAX_TEXT_UNITS = 100_000
const MAX_TEXT_BYTES = 400 * 1024
const MAX_STDOUT_BYTES = 1024 * 1024
const MAX_STDERR_BYTES = 64 * 1024
const TIMEOUT_MS = 15_000
const CHILD_FAILURES = new Set(['encrypted', 'invalid', 'too_many_pages', 'text_limit', 'empty', 'failed'])

function aborted() {
  return Object.assign(new Error('Resume text operation aborted'), { name: 'AbortError' })
}

// One slot for storage admission; a separate child slot also protects direct calls.
function createSlot() {
  let busy = false
  const queue: (() => void)[] = []
  return (signal: AbortSignal): Promise<() => void> => new Promise((resolve, reject) => {
    let waiting = true
    const cancel = () => {
      if (!waiting) return
      waiting = false
      const index = queue.indexOf(enter)
      if (index >= 0) queue.splice(index, 1)
      signal.removeEventListener('abort', cancel)
      reject(aborted())
    }
    const enter = () => {
      if (!waiting) return
      if (signal.aborted) { cancel(); return }
      waiting = false
      busy = true
      signal.removeEventListener('abort', cancel)
      let released = false
      resolve(() => {
        if (released) return
        released = true
        busy = false
        queue.shift()?.()
      })
    }
    signal.addEventListener('abort', cancel, { once: true })
    if (signal.aborted) cancel()
    else if (busy) queue.push(enter)
    else enter()
  })
}
const takeAdmission = createSlot()
const takeChild = createSlot()

export async function withResumeTextSlot<T>(
  work: (signal: AbortSignal) => Promise<T>,
  options: { signal: AbortSignal },
): Promise<T> {
  const release = await takeAdmission(options.signal)
  try {
    if (options.signal.aborted) throw aborted()
    return await work(options.signal)
  } finally { release() }
}

function childEnvironment(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { NODE_ENV: 'production' }
  for (const key of ['NODE_ENV', 'SystemRoot', 'WINDIR', 'TEMP', 'TMP']) {
    const value = process.env[key]
    if (value !== undefined) env[key] = value
  }
  return env
}

function parseOutput(bytes: Buffer, maxPages: number): ResumeTextResult {
  try {
    const value: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error()
    const record = value as Record<string, unknown>
    if (record.v !== 1) throw new Error()
    const keys = Object.keys(record).sort().join(',')
    if (record.ok === false && keys === 'ok,reason,v' &&
      typeof record.reason === 'string' && CHILD_FAILURES.has(record.reason)) {
      return { ok: false, reason: record.reason as ResumeTextFailure }
    }
    if (record.ok !== true || keys !== 'ok,pageCount,text,v' ||
      typeof record.pageCount !== 'number' || !Number.isInteger(record.pageCount) ||
      record.pageCount < 1 || record.pageCount > maxPages ||
      typeof record.text !== 'string' || !record.text.trim() ||
      record.text.length > MAX_TEXT_UNITS || Buffer.byteLength(record.text, 'utf8') > MAX_TEXT_BYTES) {
      throw new Error()
    }
    return { ok: true, text: record.text, pageCount: record.pageCount }
  } catch { return { ok: false, reason: 'protocol_error' } }
}

async function runChild(bytes: Buffer, maxPages: number, signal: AbortSignal): Promise<ResumeTextResult> {
  const root = process.cwd()
  const entry = path.resolve(root, 'src/server/lib/pdf-text-child.mjs')
  if (!existsSync(entry)) return { ok: false, reason: 'child_failed' }
  const startedAt = Date.now()
  let child: ReturnType<typeof spawn>
  try {
    child = spawn(process.execPath, ['--max-old-space-size=128', entry, '--max-pages', String(maxPages)], {
      cwd: root, shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], env: childEnvironment(),
    })
  } catch { return { ok: false, reason: 'child_failed' } }

  return new Promise<ResumeTextResult>(resolve => {
    let settled = false
    let failure: ResumeTextFailure | undefined
    let stdoutBytes = 0
    let stderrBytes = 0
    const chunks: Buffer[] = []
    let timer: ReturnType<typeof setTimeout> | undefined

    const finish = (result: ResumeTextResult) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      signal.removeEventListener('abort', onAbort)
      chunks.length = 0
      resolve(result)
    }
    const terminate = (reason: ResumeTextFailure) => {
      if (settled || failure) return
      failure = reason
      chunks.length = 0
      child.stdin?.destroy()
      // Sending a signal is not completion. Keep the slot until actual close,
      // including kill(false)/kill throwing; never admit a replacement early.
      try { child.kill('SIGKILL') } catch { /* close remains authoritative */ }
    }
    const onAbort = () => terminate('aborted')
    child.on('error', () => {
      if (child.pid === undefined) finish({ ok: false, reason: failure ?? 'child_failed' })
      else terminate('child_failed')
    })
    child.on('close', (code, exitSignal) => {
      if (settled) return
      const result: ResumeTextResult = failure ? { ok: false, reason: failure }
        : signal.aborted ? { ok: false, reason: 'aborted' }
        : code !== 0 || exitSignal !== null ? { ok: false, reason: 'child_failed' }
        : parseOutput(Buffer.concat(chunks, stdoutBytes), maxPages)
      finish(result)
    })
    child.stdout?.on('data', (chunk: Buffer) => {
      if (settled || failure) return
      stdoutBytes += chunk.length
      if (stdoutBytes > MAX_STDOUT_BYTES) { terminate('output_limit'); return }
      chunks.push(chunk)
    })
    child.stderr?.on('data', (chunk: Buffer) => {
      // Consume diagnostics without retaining or logging them.
      stderrBytes += chunk.length
      if (stderrBytes > MAX_STDERR_BYTES) terminate('output_limit')
    })
    child.stdin?.on('error', () => terminate('child_failed'))
    timer = setTimeout(() => terminate('timeout'), Math.max(0, TIMEOUT_MS - (Date.now() - startedAt)))
    signal.addEventListener('abort', onAbort, { once: true })
    if (signal.aborted) onAbort()
    else {
      try { child.stdin?.end(bytes) } catch { terminate('child_failed') }
    }
  })
}

export async function extractResumeText(
  bytes: Buffer,
  options: { maxPages: number; signal: AbortSignal },
): Promise<ResumeTextResult> {
  const { maxPages, signal } = options
  if (signal.aborted) return { ok: false, reason: 'aborted' }
  if (!Buffer.isBuffer(bytes) || bytes.length === 0 || bytes.length > MAX_INPUT_BYTES) {
    return { ok: false, reason: 'input_limit' }
  }
  if (!Number.isInteger(maxPages) || maxPages < 1 || maxPages > 100) return { ok: false, reason: 'invalid' }
  let release: (() => void) | undefined
  try {
    release = await takeChild(signal)
    if (signal.aborted) return { ok: false, reason: 'aborted' }
    return await runChild(bytes, maxPages, signal)
  } catch { return { ok: false, reason: signal.aborted ? 'aborted' : 'child_failed' } }
  finally { release?.() }
}
