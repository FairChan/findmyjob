/* Dedicated E2E process preload. No application import, SDK replacement or production branch. */
const fs = require('node:fs')
const path = require('node:path')
const http = require('node:http')
const https = require('node:https')
const net = require('node:net')
const { syncBuiltinESMExports } = require('node:module')

const KEY = 'SYNTHETIC_T02_NO_EXTERNAL_AI'
const MODEL = 'synthetic-t02-jd-model'
const endpoint = 'https://api.anthropic.com/v1/messages'
const directory = process.env.T02_AI_FIXTURE_DIR
const runId = process.env.T02_AI_RUN_ID
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
if (process.env.APP_ENV !== 'ci' || process.env.ANTHROPIC_API_KEY !== KEY || process.env.AI_MODEL_JD !== MODEL ||
  !directory || !path.isAbsolute(directory) || !fs.statSync(directory).isDirectory() || !uuid.test(runId ?? '')) {
  throw new Error('T02 synthetic HTTP configuration required')
}

function record(event, requestId, reason) {
  // Log only fixed events/reasons and a synthetic UUID; never headers, text, credentials or bodies.
  fs.appendFileSync(path.join(directory, 'events.jsonl'), JSON.stringify({ runId, event, ...(requestId ? { requestId } : {}), ...(reason ? { reason } : {}) }) + '\n')
}
function block(reason) { record('blocked', undefined, reason); throw new Error('Unexpected outbound request in T02 offline E2E') }
function loopback(host) { return ['localhost', '127.0.0.1', '::1', '[::1]'].includes(String(host).toLowerCase()) }
function exactKeys(value, expected) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) &&
    JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...expected].sort())
}

// Also stop HTTPS/HTTP fallbacks and direct socket clients before any external connection.
// Local Postgres, Next.js and internal IPC remain available. No external host is allowlisted.
for (const protocol of [http, https]) {
  for (const method of ['request', 'get']) {
    const original = protocol[method]
    protocol[method] = function (input, ...args) {
      let host
      if (typeof input === 'string' || input instanceof URL) {
        try { host = new URL(input).hostname } catch { return block('http_invalid_url') }
      } else host = input?.hostname ?? input?.host ?? 'localhost'
      if (!loopback(host)) return block('http_external_host')
      return original.call(this, input, ...args)
    }
  }
}
const originalConnect = net.Socket.prototype.connect
net.Socket.prototype.connect = function (...args) {
  const first = Array.isArray(args[0]) ? args[0][0] : args[0]
  if (first && typeof first === 'object') {
    // Node IPC/Unix-domain sockets use path rather than a network destination.
    if (!first.path && !loopback(first.host ?? first.hostname ?? 'localhost')) return block('socket_external_host')
  } else if (typeof first === 'number') {
    if (typeof args[1] === 'string' && !loopback(args[1])) return block('socket_external_host')
  } else if (typeof first === 'string') {
    if (/^\d+$/.test(first)) {
      if (typeof args[1] === 'string' && !loopback(args[1])) return block('socket_external_host')
    } else if (!path.isAbsolute(first) && !first.startsWith('\\\\.\\pipe\\')) return block('socket_invalid_path')
  } else return block('socket_invalid_options')
  return originalConnect.apply(this, args)
}
syncBuiltinESMExports()

async function syntheticMessage(request) {
  let plan, body
  try {
    plan = JSON.parse(fs.readFileSync(path.join(directory, 'plan.json'), 'utf8'))
    const text = await request.text()
    if (text.length > 32 * 1024) return block('request_size')
    body = JSON.parse(text)
  } catch { return block('request_json') }
  // SDK 1.6.0 apiKeyAuth uses Bearer authorization, not the older x-api-key header.
  if (request.method !== 'POST' || request.headers.get('authorization') !== 'Bearer ' + KEY || request.headers.has('x-api-key')) return block('request_method_or_key')
  if (!request.headers.get('user-agent')?.includes('Anthropic/JS')) return block('request_agent')
  if (plan.runId !== runId || !uuid.test(plan.requestId ?? '') || typeof plan.hold !== 'boolean' ||
    !exactKeys(plan.output, ['zh', 'en']) ||
    ![plan.output.zh, plan.output.en].every(value => typeof value === 'string' && value.trim() && value.length <= 4000)) return block('fixture_contract')
  if (!exactKeys(body, ['model', 'max_tokens', 'system', 'messages', 'output_config'])) return block('request_keys')
  if (body.model !== MODEL || body.max_tokens !== 4096) return block('request_model_or_tokens')
  if (typeof body.system !== 'string' || !body.system.includes('untrusted data') || !body.system.includes('Chinese (zh) and English (en)')) return block('request_system')
  if (!Array.isArray(body.messages) || body.messages.length !== 1 ||
    !exactKeys(body.messages[0], ['role', 'content']) || body.messages[0].role !== 'user' ||
    typeof body.messages[0].content !== 'string' || !exactKeys(body.output_config, ['format'])) return block('request_messages')
  let content
  try { content = JSON.parse(body.messages[0].content) } catch { return block('content_json') }
  const format = body.output_config.format
  if (!exactKeys(content, ['title', 'points']) || content.title !== plan.title || content.points !== plan.points ||
    format?.type !== 'json_schema' || !exactKeys(format.schema?.properties, ['zh', 'en']) ||
    format.schema.properties.zh.type !== 'string' || format.schema.properties.en.type !== 'string' ||
    JSON.stringify([...(format.schema.required ?? [])].sort()) !== JSON.stringify(['en', 'zh'])) return block('output_contract')
  try { fs.closeSync(fs.openSync(path.join(directory, plan.requestId + '.accepted'), 'wx')) } catch { return block('duplicate_request') }
  record('accepted', plan.requestId)
  const started = Date.now()
  while (plan.hold && !fs.existsSync(path.join(directory, plan.requestId + '.release'))) {
    if (request.signal.aborted) { record('aborted', plan.requestId); throw new DOMException('Aborted', 'AbortError') }
    if (Date.now() - started > 15_000) { record('hold_timeout', plan.requestId); throw new Error('Synthetic response was not released') }
    await new Promise(resolve => setTimeout(resolve, 25))
  }
  if (request.signal.aborted) { record('aborted', plan.requestId); throw new DOMException('Aborted', 'AbortError') }
  record('returned', plan.requestId)
  return new Response(JSON.stringify({
    id: 'msg_synthetic_' + plan.requestId.replaceAll('-', ''), type: 'message', role: 'assistant', model: MODEL,
    content: [{ type: 'text', text: JSON.stringify(plan.output) }], stop_reason: 'end_turn', stop_sequence: null,
    usage: { input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
  }), { status: 200, headers: { 'content-type': 'application/json', 'request-id': plan.requestId } })
}

const originalFetch = globalThis.fetch
globalThis.fetch = async function (input, init) {
  let request
  try { request = new Request(input, init) } catch { return block('fetch_invalid_request') }
  const url = new URL(request.url)
  if (url.href === endpoint) return syntheticMessage(request)
  // Next dev probes version metadata and its installed version's advisories.
  // Keep both offline and unavailable; never fabricate version/security results.
  const noCredentials = !request.headers.has('authorization') && !request.headers.has('cookie') && !request.headers.has('x-api-key')
  if (url.href === 'https://registry.npmjs.org/-/package/next/dist-tags' && request.method === 'GET' && request.body === null && noCredentials) {
    record('development_metadata_denied', undefined, 'next_dist_tags')
    return new Response(null, { status: 503 })
  }
  if (url.href === 'https://registry.npmjs.org/-/npm/v1/security/advisories/bulk' && request.method === 'POST' && noCredentials) {
    const expected = JSON.stringify({ next: [require('next/package.json').version] })
    if (await request.text() !== expected) return block('unexpected_advisory_body')
    record('development_metadata_denied', undefined, 'next_installed_advisories')
    return new Response(null, { status: 503 })
  }
  if (!loopback(url.hostname) || !['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    return block(url.href === 'https://registry.npmjs.org/-/npm/v1/security/advisories/bulk' ? 'fetch_next_advisory_probe'
      : url.href === 'https://registry.npmjs.org/next' ? 'fetch_next_package_probe' : 'fetch_external_destination')
  }
  // Any redirected external connection is still denied by the socket guard above.
  return originalFetch(input, init)
}
record('preload_ready')
