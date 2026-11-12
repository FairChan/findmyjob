// Dedicated E2E server preload only. No production switch or endpoint override.
const fs = require('node:fs')
const https = require('node:https')
const { syncBuiltinESMExports } = require('node:module')
if (process.env.VOYAGE_API_KEY !== 'SYNTHETIC_T03_NO_EXTERNAL_AI' || process.env.AI_MODEL_EMBED !== 'synthetic-t03-embedding' || !process.env.T03_AI_LOG) throw new Error('Synthetic matching configuration required')
const log = marker => fs.appendFileSync(process.env.T03_AI_LOG, marker + '\n')
const isAI = value => /(^|\.)(voyageai|anthropic)\.com(?::\d+)?$/i.test(value)
function block() { log('UNEXPECTED_AI'); throw new Error('External inference prohibited in T03 UI tests') }
const originalFetch = globalThis.fetch
globalThis.fetch = async function (input, init) {
  const url = new URL(input instanceof Request ? input.url : input)
  if (!isAI(url.hostname)) return originalFetch(input, init)
  if (process.env.T03_VECTOR_LANE !== '1' || url.href !== 'https://api.voyageai.com/v1/embeddings') return block()
  if (init?.signal?.aborted) throw new DOMException('Aborted', 'AbortError')
  const headers = new Headers(init?.headers)
  if (init?.method !== 'POST' || headers.get('authorization') !== 'Bearer SYNTHETIC_T03_NO_EXTERNAL_AI' || typeof init.body !== 'string') return block()
  const body = JSON.parse(init.body)
  if (body.model !== 'synthetic-t03-embedding' || body.input_type !== 'query' || body.output_dimension !== 1024 || body.truncation !== false) return block()
  log('SYNTHETIC_QUERY')
  return new Response(JSON.stringify({ object: 'list', model: body.model,
    data: [{ object: 'embedding', index: 0, embedding: Array.from({ length: 1024 }, (_, i) => i === 0 ? 1 : 0) }],
  }), { status: 200, headers: { 'content-type': 'application/json' } })
}
for (const method of ['request', 'get']) {
  const original = https[method]
  https[method] = function (value, ...args) {
    const hostname = typeof value === 'string' || value instanceof URL ? new URL(value).hostname : value?.hostname ?? value?.host ?? ''
    if (isAI(hostname)) return block()
    return original.call(this, value, ...args)
  }
}
syncBuiltinESMExports()
