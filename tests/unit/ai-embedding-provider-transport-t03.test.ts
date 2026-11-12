import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const ports = vi.hoisted(() => ({
  env: { VOYAGE_API_KEY: 'synthetic-project-key', AI_MODEL_EMBED: 'synthetic-embedding-model' } as {
    VOYAGE_API_KEY: string | undefined; AI_MODEL_EMBED: string | undefined
  },
  setting: vi.fn<(key: string, fallback: unknown, options?: { fresh?: boolean }) => Promise<unknown>>(),
}))
vi.mock('@/env', () => ({ env: ports.env }))
vi.mock('@/server/services/settings', () => ({ getSetting: ports.setting }))
import { embedMatchingText } from '@/server/lib/ai/embedding-provider'

const fetchMock = vi.fn<typeof fetch>()
const model = 'synthetic-embedding-model'
const legal = '2026-11-draft'
const gate = () => ({ enabled: true, legalVersion: legal, epoch: 'b0dd49f6-6ec8-44b8-b146-2c263afefce1', configurationId: 'matching-public-v1' })
const input = () => ({ text: 'Synthetic public career text', inputType: 'query' as const, model, configurationId: 'matching-public-v1' })
const options = () => ({ signal: new AbortController().signal })
const vector = () => [1, ...Array<number>(1023).fill(0)]
const valid = () => ({ object: 'list', model, data: [{ object: 'embedding', index: 0, embedding: vector() }], usage: { total_tokens: 5 } })
const response = (body: unknown = valid()) => new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } })
function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}
function pendingBody() {
  const read = deferred<void>(), cancelled = deferred<void>(), cleanup = deferred<void>()
  const cancel = vi.fn(() => { cancelled.resolve(); return cleanup.promise })
  const body = new ReadableStream<Uint8Array>({ pull() { read.resolve() }, cancel }, { highWaterMark: 0 })
  return { body, read, cancelled, cleanup, cancel }
}
function untouchedBody() {
  const pull = vi.fn(), cancel = vi.fn()
  return { body: new ReadableStream<Uint8Array>({ pull, cancel }, { highWaterMark: 0 }), pull, cancel }
}

beforeEach(() => {
  ports.env.VOYAGE_API_KEY = 'synthetic-project-key'
  ports.env.AI_MODEL_EMBED = model
  ports.setting.mockReset().mockImplementation(async (key, fallback) => key === 'ai.matching' ? gate() : key === 'legal.currentVersion' ? legal : fallback)
  fetchMock.mockReset().mockImplementation(async () => response())
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

describe('M9-T03 real native HTTP adapter with synthetic boundaries', () => {
  it.each(['query', 'document'] as const)('sends one exact minimized %s text to the fixed host with no redirect or retry', async inputType => {
    const text = '  {"headline":"Synthetic / career"}\n'
    const result = await embedMatchingText({ ...input(), text, inputType }, options())
    expect(result).toEqual({ ok: true, vector: vector(), model })
    expect(fetchMock).toHaveBeenCalledOnce()
    const [url, request] = fetchMock.mock.calls[0]
    expect(url).toBe('https://api.voyageai.com/v1/embeddings')
    expect(request).toMatchObject({ method: 'POST', redirect: 'error' })
    expect(new Headers(request?.headers).get('authorization')).toBe('Bearer synthetic-project-key')
    expect(new Headers(request?.headers).get('content-type')).toBe('application/json')
    expect(JSON.parse(String(request?.body))).toEqual({ input: [text], model, input_type: inputType, output_dimension: 1024, output_dtype: 'float', truncation: false })
    expect(request?.signal).toBeInstanceOf(AbortSignal)
    expect(ports.setting).toHaveBeenCalledWith('ai.matching', null, { fresh: true })
    expect(ports.setting).toHaveBeenCalledWith('legal.currentVersion', '2026-11-draft', { fresh: true })
  })

  it.each(['absent', 'disabled', 'missing-legal', 'wrong-legal', 'bad-epoch', 'wrong-config', 'extra-key', 'bad-enabled'] as const)('keeps %s matching gate closed without HTTP', async fault => {
    const candidate: Record<string, unknown> = gate()
    if (fault === 'disabled') candidate.enabled = false
    if (fault === 'missing-legal') candidate.legalVersion = null
    if (fault === 'wrong-legal') candidate.legalVersion = 'old-legal'
    if (fault === 'bad-epoch') candidate.epoch = 'not-a-uuid'
    if (fault === 'wrong-config') candidate.configurationId = 'unknown'
    if (fault === 'extra-key') candidate.providerUrl = 'https://synthetic.invalid'
    if (fault === 'bad-enabled') candidate.enabled = 'true'
    ports.setting.mockImplementation(async (key, fallback) => key === 'ai.matching' ? fault === 'absent' ? fallback : candidate : legal)
    await expect(embedMatchingText(input(), options())).resolves.toEqual({ ok: false, reason: 'configuration' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it.each([null, '', {}, 12])('rejects invalid current legal value %j', async current => {
    ports.setting.mockImplementation(async key => key === 'ai.matching' ? gate() : current)
    await expect(embedMatchingText(input(), options())).resolves.toEqual({ ok: false, reason: 'configuration' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it.each(['missing-key', 'empty-key', 'header-key', 'missing-model', 'empty-model', 'malformed-model', 'long-model', 'model-change', 'unknown-config'] as const)('rejects %s deployment configuration before HTTP', async fault => {
    const request = input()
    if (fault === 'missing-key') ports.env.VOYAGE_API_KEY = undefined
    if (fault === 'empty-key') ports.env.VOYAGE_API_KEY = '  '
    if (fault === 'header-key') ports.env.VOYAGE_API_KEY = 'synthetic\nkey'
    if (fault === 'missing-model') ports.env.AI_MODEL_EMBED = undefined
    if (fault === 'empty-model') ports.env.AI_MODEL_EMBED = ''
    if (fault === 'malformed-model') ports.env.AI_MODEL_EMBED = 'bad model'
    if (fault === 'long-model') ports.env.AI_MODEL_EMBED = 'm'.repeat(201)
    if (fault === 'model-change') ports.env.AI_MODEL_EMBED = 'new-synthetic-model'
    if (fault === 'unknown-config') request.configurationId = 'unknown'
    await expect(embedMatchingText(request, options())).resolves.toEqual({ ok: false, reason: 'configuration' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it.each(['empty', 'blank', 'over-text-cap', 'non-string', 'wrong-input-type'] as const)('rejects %s input without truncation or HTTP', async fault => {
    const request: Record<string, unknown> = input()
    if (fault === 'empty') request.text = ''
    if (fault === 'blank') request.text = ' \n\t '
    if (fault === 'over-text-cap') request.text = 'x'.repeat(8001)
    if (fault === 'non-string') request.text = ['synthetic']
    if (fault === 'wrong-input-type') request.inputType = 'both'
    await expect(embedMatchingText(request as ReturnType<typeof input>, options())).resolves.toEqual({ ok: false, reason: 'invalid' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it.each(['utf16', 'multibyte', 'json-escape'] as const)('accepts the 8000-unit boundary unchanged for %s text', async kind => {
    const text = kind === 'utf16' ? 'x'.repeat(8000) : kind === 'multibyte' ? '界'.repeat(8000) : '\u0000'.repeat(8000)
    await expect(embedMatchingText({ ...input(), text }, options())).resolves.toEqual({ ok: true, vector: vector(), model })
    const body = String(fetchMock.mock.calls[0][1]?.body)
    expect(JSON.parse(body).input).toEqual([text])
    expect(Buffer.byteLength(body, 'utf8')).toBeLessThanOrEqual(64 * 1024)
  })

  it('rechecks the model after the awaited fresh gate reads before egress', async () => {
    ports.setting.mockImplementation(async key => {
      if (key === 'legal.currentVersion') { ports.env.AI_MODEL_EMBED = 'replacement-model'; return legal }
      return gate()
    })
    await expect(embedMatchingText(input(), options())).resolves.toEqual({ ok: false, reason: 'configuration' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('fresh-checks the gate on each independent request', async () => {
    await expect(embedMatchingText(input(), options())).resolves.toEqual({ ok: true, vector: vector(), model })
    ports.setting.mockImplementation(async key => key === 'ai.matching' ? { ...gate(), enabled: false } : legal)
    await expect(embedMatchingText(input(), options())).resolves.toEqual({ ok: false, reason: 'configuration' })
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it('discards an old model response when the deployment model changes during HTTP', async () => {
    fetchMock.mockImplementation(async () => { ports.env.AI_MODEL_EMBED = 'replacement-model'; return response() })
    await expect(embedMatchingText(input(), options())).resolves.toEqual({ ok: false, reason: 'configuration' })
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it('returns a fixed failure for settings errors without sending or exposing the raw error', async () => {
    ports.setting.mockRejectedValue(new Error('PRIVATE_SETTINGS_ERROR'))
    await expect(embedMatchingText(input(), options())).resolves.toEqual({ ok: false, reason: 'unavailable' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it.each(['dimension', 'index', 'model', 'empty-data', 'two-data', 'wrong-list', 'wrong-object', 'null-component', 'string-component', 'boolean-component', 'zero', 'float32-overflow', 'float32-underflow'] as const)('rejects %s response through the shared vector/schema rules', async fault => {
    const body = valid()
    if (fault === 'dimension') body.data[0].embedding = [1]
    if (fault === 'index') body.data[0].index = 1
    if (fault === 'model') body.model = 'wrong-model'
    if (fault === 'empty-data') body.data = []
    if (fault === 'two-data') body.data.push(body.data[0])
    if (fault === 'wrong-list') body.object = 'other'
    if (fault === 'wrong-object') body.data[0].object = 'other'
    if (fault === 'null-component') body.data[0].embedding[0] = null as unknown as number
    if (fault === 'string-component') body.data[0].embedding[0] = '1' as unknown as number
    if (fault === 'boolean-component') body.data[0].embedding[0] = true as unknown as number
    if (fault === 'zero') body.data[0].embedding = Array<number>(1024).fill(0)
    if (fault === 'float32-overflow') body.data[0].embedding[0] = 1e39
    if (fault === 'float32-underflow') body.data[0].embedding[0] = 1e-50
    fetchMock.mockResolvedValue(response(body))
    await expect(embedMatchingText(input(), options())).resolves.toEqual({ ok: false, reason: 'invalid' })
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it.each(['1e400', '-1e400', 'NaN', 'Infinity'])('rejects nonfinite or non-JSON numeric token %s', async token => {
    const body = JSON.stringify(valid()).replace('"embedding":[1,', '"embedding":[' + token + ',')
    fetchMock.mockResolvedValue(new Response(body, { headers: { 'content-type': 'application/json' } }))
    await expect(embedMatchingText(input(), options())).resolves.toEqual({ ok: false, reason: 'invalid' })
  })

  it('accepts finite negative and float32-range values without inventing normalization', async () => {
    const body = valid()
    body.data[0].embedding[0] = -3.4e38
    body.data[0].embedding[1] = 1e-30
    fetchMock.mockResolvedValue(response(body))
    await expect(embedMatchingText(input(), options())).resolves.toEqual({ ok: true, vector: body.data[0].embedding, model })
  })

  it.each(['null', '[]', '{}', '{', ''])('rejects malformed or missing envelope %j', async body => {
    fetchMock.mockResolvedValue(new Response(body, { headers: { 'content-type': 'application/json' } }))
    await expect(embedMatchingText(input(), options())).resolves.toEqual({ ok: false, reason: 'invalid' })
  })

  it.each([[400, 'invalid'], [401, 'configuration'], [403, 'configuration'], [404, 'configuration'], [408, 'timeout'], [429, 'unavailable'], [500, 'unavailable'], [503, 'unavailable'], [302, 'unavailable']] as const)('maps HTTP %s without reading its body or multiplying retries', async (status, reason) => {
    const stream = untouchedBody()
    fetchMock.mockResolvedValue(new Response(stream.body, { status, headers: { location: 'https://synthetic.invalid/redirect' } }))
    await expect(embedMatchingText(input(), options())).resolves.toEqual({ ok: false, reason })
    expect(fetchMock).toHaveBeenCalledOnce()
    expect(stream.pull).not.toHaveBeenCalled()
    expect(stream.cancel).toHaveBeenCalledOnce()
  })

  it('masks redirect/network failures and recovers on a later independent call', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('PRIVATE_TEXT_KEY_AND_NETWORK_ERROR'))
    await expect(embedMatchingText(input(), options())).resolves.toEqual({ ok: false, reason: 'unavailable' })
    await expect(embedMatchingText(input(), options())).resolves.toEqual({ ok: true, vector: vector(), model })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it.each(['text/html', '', 'application/json; charset=iso-8859-1'])('rejects unsupported content type %j before reading a body', async contentType => {
    const stream = untouchedBody()
    fetchMock.mockResolvedValue(new Response(stream.body, { headers: { 'content-type': contentType } }))
    await expect(embedMatchingText(input(), options())).resolves.toEqual({ ok: false, reason: 'invalid' })
    expect(stream.pull).not.toHaveBeenCalled()
    expect(stream.cancel).toHaveBeenCalledOnce()
  })

  it('rejects a declared oversized body before reading it', async () => {
    const stream = untouchedBody()
    fetchMock.mockResolvedValue(new Response(stream.body, { headers: { 'content-type': 'application/json', 'content-length': String(256 * 1024 + 1) } }))
    await expect(embedMatchingText(input(), options())).resolves.toEqual({ ok: false, reason: 'invalid' })
    expect(stream.pull).not.toHaveBeenCalled()
    expect(stream.cancel).toHaveBeenCalledOnce()
  })

  it.each(['-1', '1.5', 'unknown', '9007199254740992'])('rejects malformed content-length %s without reading', async length => {
    const stream = untouchedBody()
    fetchMock.mockResolvedValue(new Response(stream.body, { headers: { 'content-type': 'application/json', 'content-length': length } }))
    await expect(embedMatchingText(input(), options())).resolves.toEqual({ ok: false, reason: 'invalid' })
    expect(stream.pull).not.toHaveBeenCalled()
    expect(stream.cancel).toHaveBeenCalledOnce()
  })

  it('rejects a successful status with no body', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204, headers: { 'content-type': 'application/json' } }))
    await expect(embedMatchingText(input(), options())).resolves.toEqual({ ok: false, reason: 'invalid' })
  })

  it.each([undefined, '1'] as const)('caps actual streamed bytes even when content-length is %s', async length => {
    const chunk = new Uint8Array(128 * 1024), cancel = vi.fn()
    let reads = 0
    const body = new ReadableStream<Uint8Array>({ pull(controller) { controller.enqueue(++reads <= 2 ? chunk : new Uint8Array(1)) }, cancel }, { highWaterMark: 0 })
    const headers: Record<string, string> = { 'content-type': 'application/json' }
    if (length !== undefined) headers['content-length'] = length
    fetchMock.mockResolvedValue(new Response(body, { headers }))
    await expect(embedMatchingText(input(), options())).resolves.toEqual({ ok: false, reason: 'invalid' })
    expect(reads).toBe(3)
    expect(cancel).toHaveBeenCalledOnce()
  })

  it('accepts valid JSON exactly at the 256 KiB response boundary', async () => {
    const json = JSON.stringify(valid())
    const body = json + ' '.repeat(256 * 1024 - Buffer.byteLength(json, 'utf8'))
    fetchMock.mockResolvedValue(new Response(body, { headers: { 'content-type': 'application/json; charset=utf-8', 'content-length': String(256 * 1024) } }))
    await expect(embedMatchingText(input(), options())).resolves.toEqual({ ok: true, vector: vector(), model })
  })

  it('rejects invalid UTF-8 inside otherwise valid JSON instead of replacing bytes', async () => {
    const bytes = Buffer.concat([Buffer.from('{"ignored":"'), Buffer.from([0xc3, 0x28]), Buffer.from('",'), Buffer.from(JSON.stringify(valid()).slice(1))])
    fetchMock.mockResolvedValue(new Response(bytes, { headers: { 'content-type': 'application/json' } }))
    await expect(embedMatchingText(input(), options())).resolves.toEqual({ ok: false, reason: 'invalid' })
  })

  it('decodes a multibyte JSON value split across stream chunks', async () => {
    const bytes = Buffer.from(JSON.stringify({ ...valid(), ignored: '界' })), split = bytes.indexOf(Buffer.from('界')) + 1
    const body = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(bytes.subarray(0, split)); controller.enqueue(bytes.subarray(split)); controller.close() } })
    fetchMock.mockResolvedValue(new Response(body, { headers: { 'content-type': 'application/json' } }))
    await expect(embedMatchingText(input(), options())).resolves.toEqual({ ok: true, vector: vector(), model })
  })

  it('masks a stream read error', async () => {
    const body = new ReadableStream<Uint8Array>({ pull(controller) { controller.error(new Error('PRIVATE_STREAM_ERROR')) } })
    fetchMock.mockResolvedValue(new Response(body, { headers: { 'content-type': 'application/json' } }))
    await expect(embedMatchingText(input(), options())).resolves.toEqual({ ok: false, reason: 'unavailable' })
  })

  it('aborts before even reading settings when the caller is already cancelled', async () => {
    const caller = new AbortController(); caller.abort()
    await expect(embedMatchingText(input(), { signal: caller.signal })).resolves.toEqual({ ok: false, reason: 'aborted' })
    expect(ports.setting).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('does not start HTTP after cancellation during a pending fresh settings read', async () => {
    const waiting = deferred<unknown>(), entered = deferred<void>(), caller = new AbortController()
    ports.setting.mockImplementation(async () => { entered.resolve(); return waiting.promise })
    const work = embedMatchingText(input(), { signal: caller.signal })
    await entered.promise
    caller.abort(); waiting.resolve(gate())
    await expect(work).resolves.toEqual({ ok: false, reason: 'aborted' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('includes fresh settings reads in the 20 second deadline without abandoning the read', async () => {
    vi.useFakeTimers()
    const waiting = deferred<unknown>(), entered = deferred<void>()
    ports.setting.mockImplementation(async () => { entered.resolve(); return waiting.promise })
    let settled = false
    const work = embedMatchingText(input(), options()).then(result => { settled = true; return result })
    try {
      await entered.promise
      await vi.advanceTimersByTimeAsync(20_000)
      expect(settled).toBe(false)
      waiting.resolve(gate())
      await expect(work).resolves.toEqual({ ok: false, reason: 'timeout' })
      expect(fetchMock).not.toHaveBeenCalled()
    } finally { waiting.resolve(gate()); await work }
  })

  it.each(['aborted', 'timeout'] as const)('retains ownership of late fetch settlement after %s and cancels the returned body', async reason => {
    vi.useFakeTimers()
    const transport = deferred<Response>(), entered = deferred<void>(), caller = new AbortController()
    const stream = untouchedBody()
    fetchMock.mockImplementation(async () => { entered.resolve(); return transport.promise })
    let settled = false
    const work = embedMatchingText(input(), { signal: caller.signal }).then(result => { settled = true; return result })
    try {
      await entered.promise
      if (reason === 'aborted') caller.abort(); else await vi.advanceTimersByTimeAsync(20_000)
      await Promise.resolve()
      expect(fetchMock.mock.calls[0][1]?.signal?.aborted).toBe(true)
      expect(settled).toBe(false)
      transport.resolve(new Response(stream.body, { headers: { 'content-type': 'application/json' } }))
      await expect(work).resolves.toEqual({ ok: false, reason })
      expect(stream.pull).not.toHaveBeenCalled()
      expect(stream.cancel).toHaveBeenCalledOnce()
    } finally { transport.resolve(response()); await work }
  })

  it.each(['aborted', 'timeout'] as const)('waits for pending reader cancellation cleanup after %s', async reason => {
    vi.useFakeTimers()
    const stream = pendingBody(), caller = new AbortController()
    fetchMock.mockResolvedValue(new Response(stream.body, { headers: { 'content-type': 'application/json' } }))
    let settled = false
    const work = embedMatchingText(input(), { signal: caller.signal }).then(result => { settled = true; return result })
    try {
      await stream.read.promise
      if (reason === 'aborted') caller.abort(); else await vi.advanceTimersByTimeAsync(20_000)
      await stream.cancelled.promise
      await Promise.resolve()
      expect(settled).toBe(false)
      expect(fetchMock.mock.calls[0][1]?.signal?.aborted).toBe(true)
      stream.cleanup.resolve()
      await expect(work).resolves.toEqual({ ok: false, reason })
      expect(stream.cancel).toHaveBeenCalledOnce()
    } finally { stream.cleanup.resolve(); caller.abort(); await work }
  })

  it('does not turn cleanup rejection into a raw error or unhandled rejection', async () => {
    const body = new ReadableStream<Uint8Array>({ cancel() { throw new Error('PRIVATE_CANCEL_ERROR') } }, { highWaterMark: 0 })
    fetchMock.mockResolvedValue(new Response(body, { status: 503 }))
    await expect(embedMatchingText(input(), options())).resolves.toEqual({ ok: false, reason: 'unavailable' })
  })

  it('does not log private errors, request text, credentials or provider bodies', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {}), warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const info = vi.spyOn(console, 'info').mockImplementation(() => {}), log = vi.spyOn(console, 'log').mockImplementation(() => {})
    fetchMock.mockResolvedValue(new Response('PRIVATE_PROVIDER_BODY', { status: 503 }))
    await expect(embedMatchingText(input(), options())).resolves.toEqual({ ok: false, reason: 'unavailable' })
    fetchMock.mockRejectedValue(new Error('PRIVATE_PROVIDER_KEY_TEXT'))
    await expect(embedMatchingText(input(), options())).resolves.toEqual({ ok: false, reason: 'unavailable' })
    for (const spy of [error, warn, info, log]) expect(spy).not.toHaveBeenCalled()
  })
})
