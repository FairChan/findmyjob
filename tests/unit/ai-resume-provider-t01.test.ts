import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const io = vi.hoisted(() => ({
  fetch: vi.fn(), create: vi.fn(), settings: vi.fn(),
  env: { ANTHROPIC_API_KEY: 'synthetic-project-key', AI_MODEL_PARSE: 'claude-synthetic-resume-v1' },
}))
vi.mock('@/env', () => ({ env: io.env }))
vi.mock('@/server/services/settings', () => ({ getSetting: io.settings }))
// Run the official SDK and its real zodOutputFormat parser against synthetic HTTP.
// Only the transport is replaced; no provider endpoint is called.
vi.mock('@anthropic-ai/sdk', async original => {
  const actual = await original<typeof import('@anthropic-ai/sdk')>()
  return { ...actual, default: class extends actual.default {
    constructor(options: ConstructorParameters<typeof actual.default>[0]) {
      super({ ...options, fetch: io.fetch as typeof globalThis.fetch })
      io.create(options)
    }
  } }
})
import { generateResumeSuggestion } from '@/server/lib/ai/resume-provider'

const model = 'claude-synthetic-resume-v1'
const epoch = '00000000-0000-4000-8000-000000000001'
const goodGate = () => ({ enabled: true, legalVersion: 'synthetic-legal-v1', epoch })
const input = () => ({ text: 'Synthetic career facts', model, promptVersion: 'resume-parse-v1', schemaVersion: 1 as const })
const suggestion = () => ({
  headline: 'Synthetic developer', summary: null, skills: ['TypeScript'],
  languages: [], educations: [], experiences: [],
})
function response(text = JSON.stringify(suggestion()), stopReason = 'end_turn', responseModel = model) {
  return new Response(JSON.stringify({
    id: 'msg_synthetic', type: 'message', role: 'assistant', model: responseModel,
    content: [{ type: 'text', text }], stop_reason: stopReason, stop_sequence: null,
    usage: { input_tokens: 1, output_tokens: 1 },
  }), { status: 200, headers: { 'content-type': 'application/json', 'request-id': 'synthetic-request' } })
}
const call = () => generateResumeSuggestion(input(), { signal: new AbortController().signal })
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}
beforeEach(() => {
  vi.resetAllMocks()
  io.env.ANTHROPIC_API_KEY = 'synthetic-project-key'
  io.env.AI_MODEL_PARSE = model
  io.settings.mockImplementation(async (key: string) => key === 'ai.resumeParse' ? goodGate() : 'synthetic-legal-v1')
  io.fetch.mockResolvedValue(response())
})
afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('T01 official Anthropic adapter', () => {
  it('uses configured model, explicit bounded SDK options and a fixed no-tool data request', async () => {
    const result = await generateResumeSuggestion({
      ...input(), text: 'Synthetic engineer contact: synthetic@example.test https://example.test/private',
    }, { signal: new AbortController().signal })
    expect(result).toEqual({ ok: true, output: suggestion(), responseModel: model })
    expect(io.fetch).toHaveBeenCalledOnce()
    expect(io.create).toHaveBeenCalledWith(expect.objectContaining({
      apiKey: 'synthetic-project-key', baseURL: 'https://api.anthropic.com',
      timeout: 45_000, maxRetries: 0, logLevel: 'off', openTelemetry: false,
    }))
    expect(io.settings).toHaveBeenCalledWith('ai.resumeParse', null, { fresh: true })
    expect(io.settings).toHaveBeenCalledWith('legal.currentVersion', null, { fresh: true })
    const [url, init] = io.fetch.mock.calls[0]
    const request = new Request(url, init)
    const body = await request.json()
    expect(request.url).toBe('https://api.anthropic.com/v1/messages')
    expect(body).toMatchObject({ model, max_tokens: 8192, output_config: { format: { type: 'json_schema' } } })
    expect(body).not.toHaveProperty('tools')
    expect(body).not.toHaveProperty('metadata')
    expect(body).not.toHaveProperty('cache_control')
    expect(body.messages).toHaveLength(1)
    expect(body.messages[0].role).toBe('user')
    expect(body.messages[0].content).not.toContain('synthetic@example.test')
    expect(body.messages[0].content).not.toContain('https://example.test/private')
    expect(body.messages[0].content).toContain('[已隐藏]')
    expect(body.system).toContain('untrusted')
  })

  it.each([
    null,
    { enabled: false, legalVersion: 'synthetic-legal-v1', epoch },
    { enabled: true, legalVersion: null, epoch },
    { enabled: true, legalVersion: 'outdated', epoch },
    { enabled: true, legalVersion: 'synthetic-legal-v1', epoch: 'bad' },
    { ...goodGate(), unexpected: true },
  ])('fails closed for missing, disabled or invalid gate %j', async gate => {
    io.settings.mockImplementation(async (key: string) => key === 'ai.resumeParse' ? gate : 'synthetic-legal-v1')
    expect(await call()).toEqual({ ok: false, reason: 'configuration' })
    expect(io.create).not.toHaveBeenCalled()
    expect(io.fetch).not.toHaveBeenCalled()
  })

  it.each(['key', 'model', 'invalid-model'] as const)('does not fall back when project %s is missing or invalid', async kind => {
    if (kind === 'key') io.env.ANTHROPIC_API_KEY = ''
    else io.env.AI_MODEL_PARSE = kind === 'model' ? '' : 'https://untrusted.invalid'
    expect(await call()).toEqual({ ok: false, reason: 'configuration' })
    expect(io.create).not.toHaveBeenCalled()
  })

  it('sends the frozen request model when the current environment model has changed', async () => {
    io.env.AI_MODEL_PARSE = 'claude-different-synthetic'
    expect(await call()).toEqual({ ok: true, output: suggestion(), responseModel: model })
    expect(io.fetch).toHaveBeenCalledOnce()
    const [url, init] = io.fetch.mock.calls[0]
    expect(await new Request(url, init).json()).toMatchObject({ model })
  })

  it.each([
    { ...input(), promptVersion: 'unapproved-version' },
    { ...input(), schemaVersion: 2 },
    { ...input(), text: '' },
    { ...input(), text: 'x'.repeat(100_001) },
    { ...input(), model: 'https://untrusted.invalid' },
  ])('rejects unsupported versions or input before constructing SDK', async value => {
    expect(await generateResumeSuggestion(value as ReturnType<typeof input>, { signal: new AbortController().signal }))
      .toEqual({ ok: false, reason: 'configuration' })
    expect(io.create).not.toHaveBeenCalled()
  })

  it.each([
    ['refusal', 'refusal'], ['max_tokens', 'truncated'],
    ['tool_use', 'invalid'], ['pause_turn', 'invalid'], ['stop_sequence', 'invalid'],
  ])('preserves %s classification even when text is not valid JSON', async (stop, reason) => {
    io.fetch.mockResolvedValueOnce(response('PRIVATE_NON_JSON_RESPONSE_SENTINEL', stop))
    expect(await call()).toEqual({ ok: false, reason })
  })

  it.each([
    '{}', '{', 'null',
    JSON.stringify({ ...suggestion(), skills: ['x'.repeat(51)] }),
    JSON.stringify({ ...suggestion(), headline: null, skills: [] }),
    JSON.stringify({ ...suggestion(), summary: 'x'.repeat(128 * 1024) }),
  ])('rejects unparseable, invalid, empty or excessive output', async text => {
    io.fetch.mockResolvedValueOnce(response(text))
    expect(await call()).toEqual({ ok: false, reason: 'invalid' })
  })

  it('projects forbidden nested keys out before returning the candidate', async () => {
    const clean = { ...suggestion(), experiences: [{
      kind: 'PROJECT', title: 'Synthetic project', organization: null,
      startDate: null, endDate: null, description: null,
    }] }
    io.fetch.mockResolvedValueOnce(response(JSON.stringify({
      ...clean, workAuth: 'MY_CITIZEN', fullName: 'PRIVATE_NAME_SENTINEL',
      experiences: [{ ...clean.experiences[0], studentId: 'PRIVATE_ID_SENTINEL' }],
    })))
    expect(await call()).toEqual({ ok: true, output: clean, responseModel: model })
  })

  it('rejects an invalid returned model identifier', async () => {
    io.fetch.mockResolvedValueOnce(response(JSON.stringify(suggestion()), 'end_turn', 'PRIVATE\nMODEL'))
    expect(await call()).toEqual({ ok: false, reason: 'invalid' })
  })

  it.each([[401, 'configuration'], [403, 'configuration'], [404, 'configuration'], [408, 'timeout'], [429, 'rate_limited'], [500, 'unavailable']] as const)(
    'maps HTTP %s to a fixed failure and never retries', async (status, reason) => {
      io.fetch.mockResolvedValueOnce(new Response(JSON.stringify({
        type: 'error', error: { type: 'synthetic_error', message: 'PRIVATE_PROVIDER_ERROR_SENTINEL' },
      }), { status, headers: { 'content-type': 'application/json' } }))
      const errorLog = vi.spyOn(console, 'error')
      const warnLog = vi.spyOn(console, 'warn')
      expect(await call()).toEqual({ ok: false, reason })
      expect(io.fetch).toHaveBeenCalledOnce()
      expect(errorLog).not.toHaveBeenCalled()
      expect(warnLog).not.toHaveBeenCalled()
    },
  )

  it.each(['abort', 'timeout'] as const)('forwards %s and waits for actual HTTP settlement', async cause => {
    vi.useFakeTimers()
    const entered = deferred<AbortSignal>()
    const release = deferred<void>()
    io.fetch.mockImplementationOnce(async (_url, options: RequestInit) => {
      entered.resolve(options.signal!)
      await release.promise
      return response()
    })
    const controller = new AbortController()
    let finished = false
    const result = generateResumeSuggestion(input(), { signal: controller.signal }).then(value => { finished = true; return value })
    const httpSignal = await Promise.race([
      entered.promise, result.then(() => { throw new Error('Provider settled before HTTP barrier') }),
    ])
    try {
      if (cause === 'abort') controller.abort(new Error('PRIVATE_ABORT_SENTINEL'))
      else await vi.advanceTimersByTimeAsync(45_000)
      expect(httpSignal.aborted).toBe(true)
      expect(finished).toBe(false)
    } finally { controller.abort(); release.resolve() }
    expect(await result).toEqual({ ok: false, reason: cause === 'abort' ? 'aborted' : 'timeout' })
  })

  it('does no work for an already aborted request', async () => {
    const controller = new AbortController()
    controller.abort()
    expect(await generateResumeSuggestion(input(), { signal: controller.signal })).toEqual({ ok: false, reason: 'aborted' })
    expect(io.settings).not.toHaveBeenCalled()
    expect(io.create).not.toHaveBeenCalled()
  })

  it('sanitizes settings failures before any SDK call', async () => {
    io.settings.mockRejectedValueOnce(new Error('PRIVATE_SETTINGS_SENTINEL'))
    expect(await call()).toEqual({ ok: false, reason: 'unavailable' })
    expect(io.fetch).not.toHaveBeenCalled()
  })
})
