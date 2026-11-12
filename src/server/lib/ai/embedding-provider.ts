import 'server-only'
import { z } from 'zod'
import { env } from '@/env'
import { getSetting } from '@/server/services/settings'
import {
  matchingGateSchema, embeddingVectorSchema, MATCHING_CONFIGURATION_ID, MATCHING_DIMENSION,
} from '@/schemas/semantic-matching'

export type MatchingEmbeddingResult =
  | { ok: true; vector: number[]; model: string }
  | { ok: false; reason: 'configuration' | 'timeout' | 'unavailable' | 'invalid' | 'aborted' }

const ENDPOINT = 'https://api.voyageai.com/v1/embeddings'
const TIMEOUT_MS = 20_000
const TEXT_MAX_UNITS = 8000
const TEXT_MAX_BYTES = 32 * 1024
const REQUEST_MAX_BYTES = 64 * 1024
const RESPONSE_MAX_BYTES = 256 * 1024
const MODEL = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/
const API_KEY = /^[\x21-\x7e]{1,4096}$/
const JSON_CONTENT_TYPE = /^application\/json(?:\s*;\s*charset\s*=\s*"?utf-8"?)?\s*$/i
const responseSchema = z.object({
  object: z.literal('list'), model: z.string(),
  data: z.array(z.object({ object: z.literal('embedding'), index: z.literal(0), embedding: embeddingVectorSchema })).length(1),
})

function currentConfiguration(model: string): { apiKey: string } | null {
  const currentModel = env.AI_MODEL_EMBED?.trim()
  const apiKey = env.VOYAGE_API_KEY?.trim()
  if (!currentModel || !MODEL.test(currentModel) || currentModel !== model || !apiKey || !API_KEY.test(apiKey)) return null
  return { apiKey }
}

function httpFailure(status: number): MatchingEmbeddingResult {
  if (status === 400) return { ok: false, reason: 'invalid' }
  if ([401, 403, 404].includes(status)) return { ok: false, reason: 'configuration' }
  if (status === 408) return { ok: false, reason: 'timeout' }
  return { ok: false, reason: 'unavailable' }
}

export async function embedMatchingText(
  input: { text: string; inputType: 'query' | 'document'; model: string; configurationId: string },
  options: { signal: AbortSignal },
): Promise<MatchingEmbeddingResult> {
  const signal = options.signal
  if (signal.aborted) return { ok: false, reason: 'aborted' }
  const { text, inputType, model, configurationId } = input
  if (configurationId !== MATCHING_CONFIGURATION_ID || !currentConfiguration(model)) {
    return { ok: false, reason: 'configuration' }
  }
  if (typeof text !== 'string' || !text.trim() || text.length > TEXT_MAX_UNITS ||
    Buffer.byteLength(text, 'utf8') > TEXT_MAX_BYTES || !['query', 'document'].includes(inputType)) {
    return { ok: false, reason: 'invalid' }
  }
  // Core owns canonical minimization/sourceHash. Do not change its exact text.
  const serialized = JSON.stringify({
    input: [text], model, input_type: inputType, output_dimension: MATCHING_DIMENSION,
    output_dtype: 'float', truncation: false,
  })
  if (Buffer.byteLength(serialized, 'utf8') > REQUEST_MAX_BYTES) return { ok: false, reason: 'invalid' }

  const controller = new AbortController()
  let cancellation: 'aborted' | 'timeout' | undefined
  let body: ReadableStream<Uint8Array> | null = null
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined
  let ended = false
  let cleanup: Promise<void> | undefined
  const discard = () => {
    if (cleanup || ended || !body) return
    try { cleanup = (reader ? reader.cancel() : body.cancel()).catch(() => {}) }
    catch { cleanup = Promise.resolve() }
  }
  const cancel = (reason: 'aborted' | 'timeout') => {
    if (cancellation) return
    cancellation = reason
    controller.abort()
    // Also release a pending read. Keep ownership of asynchronous cancellation.
    discard()
  }
  const onAbort = () => cancel('aborted')
  signal.addEventListener('abort', onAbort, { once: true })
  const timer = setTimeout(() => cancel('timeout'), TIMEOUT_MS)
  if (signal.aborted) onAbort()

  try {
    const gate = matchingGateSchema.safeParse(await getSetting<unknown>('ai.matching', null, { fresh: true }))
    if (cancellation) return { ok: false, reason: cancellation }
    if (!gate.success || !gate.data.enabled || !gate.data.legalVersion) return { ok: false, reason: 'configuration' }
    const legal = await getSetting<unknown>('legal.currentVersion', '2026-11-draft', { fresh: true })
    if (cancellation) return { ok: false, reason: cancellation }
    const configuration = currentConfiguration(model)
    if (typeof legal !== 'string' || !legal.trim() || gate.data.legalVersion !== legal || !configuration) {
      return { ok: false, reason: 'configuration' }
    }
    // Actor/consent/source/revision/epoch authorization stays in core. No DB
    // transaction is held across HTTP; these fresh reads are defense in depth.
    const response = await fetch(ENDPOINT, {
      method: 'POST', redirect: 'error', signal: controller.signal,
      headers: { authorization: 'Bearer ' + configuration.apiKey, 'content-type': 'application/json' },
      body: serialized,
    })
    body = response.body
    if (cancellation) return { ok: false, reason: cancellation }
    if (!response.ok) return httpFailure(response.status)
    if (response.redirected || (response.url && response.url !== ENDPOINT) ||
      !JSON_CONTENT_TYPE.test(response.headers.get('content-type')?.trim() ?? '') || !body) {
      return { ok: false, reason: 'invalid' }
    }
    const contentLength = response.headers.get('content-length')
    if (contentLength !== null && (!/^\d+$/.test(contentLength) || !Number.isSafeInteger(Number(contentLength)) || Number(contentLength) > RESPONSE_MAX_BYTES)) {
      return { ok: false, reason: 'invalid' }
    }

    reader = body.getReader()
    const chunks: Uint8Array[] = []
    let bytes = 0
    while (true) {
      const chunk = await reader.read()
      if (cancellation) return { ok: false, reason: cancellation }
      if (chunk.done) { ended = true; break }
      bytes += chunk.value.byteLength
      // Count decoded stream bytes; Content-Length is only an early rejection.
      if (bytes > RESPONSE_MAX_BYTES) return { ok: false, reason: 'invalid' }
      chunks.push(chunk.value)
    }
    let decoded: unknown
    try { decoded = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks, bytes))) }
    catch { return { ok: false, reason: 'invalid' } }
    const parsed = responseSchema.safeParse(decoded)
    if (!parsed.success || parsed.data.model !== model) return { ok: false, reason: 'invalid' }
    // A deployment model change invalidates this result even without epoch rotation.
    if (!currentConfiguration(model)) return { ok: false, reason: 'configuration' }
    return { ok: true, vector: parsed.data.data[0].embedding, model }
  } catch {
    return { ok: false, reason: cancellation ?? 'unavailable' }
  } finally {
    discard()
    // Never race away from a pending transport/body cleanup and report success.
    // A transport ignoring abort can exceed the deadline; core still owns its lease.
    if (cleanup) await cleanup
    try { reader?.releaseLock() } catch { /* Teardown must not expose transport errors. */ }
    clearTimeout(timer)
    signal.removeEventListener('abort', onAbort)
  }
}
