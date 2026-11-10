/* Dedicated test-process guard. No synthetic email/AI success and no application imports. */
const fs = require('node:fs')
const path = require('node:path')
const http = require('node:http')
const https = require('node:https')
const net = require('node:net')
const { syncBuiltinESMExports } = require('node:module')

const directory = process.env.T04_OFFLINE_DIR
const runId = process.env.T04_OFFLINE_RUN_ID
if (process.env.APP_ENV !== 'ci' || !runId || !directory || !path.isAbsolute(directory) ||
  !fs.statSync(directory).isDirectory() || process.env.EMAIL_PROVIDER !== 'smtp' || process.env.SMTP_URL !== 'smtp://127.0.0.1:1025' ||
  process.env.ANTHROPIC_API_KEY !== 'SYNTHETIC_T04_NO_AI' ||
  !process.env.T04_SYNTHETIC_SECRET || process.env.T04_SYNTHETIC_SECRET.length < 32 ||
  process.env.MARKETING_UNSUBSCRIBE_SECRET !== process.env.T04_SYNTHETIC_SECRET) {
  throw new Error('Dedicated T04 offline config required')
}
function record(event) { fs.appendFileSync(path.join(directory, 'events.jsonl'), JSON.stringify({ runId, event }) + '\n') }
function block() { record('blocked'); throw new Error('Outbound network prohibited in T04 offline E2E') }
function loopback(host) { return ['localhost', '127.0.0.1', '::1', '[::1]'].includes(String(host).toLowerCase()) }
function allowed(host, port) { return loopback(host) && ![25, 465, 587, 1025, 2525].includes(Number(port)) }
for (const protocol of [http, https]) {
  for (const method of ['request', 'get']) {
    const original = protocol[method]
    protocol[method] = function (input, ...args) {
      let target
      if (typeof input === 'string' || input instanceof URL) {
        try { target = new URL(input) } catch { return block() }
      } else target = input ?? {}
      if (!allowed(target.hostname ?? target.host ?? 'localhost', target.port)) return block()
      return original.call(this, input, ...args)
    }
  }
}
const originalConnect = net.Socket.prototype.connect
net.Socket.prototype.connect = function (...args) {
  const normalized = Array.isArray(args[0]) ? args[0] : args
  const first = normalized[0]
  if (first && typeof first === 'object') {
    if (!first.path && !allowed(first.host ?? first.hostname ?? 'localhost', first.port)) return block()
  } else if (typeof first === 'number' || typeof first === 'string' && /^\d+$/.test(first)) {
    if (!allowed(typeof normalized[1] === 'string' ? normalized[1] : 'localhost', first)) return block()
  } else if (typeof first !== 'string' || !path.isAbsolute(first) && !first.startsWith('\\\\.\\pipe\\')) return block()
  return originalConnect.apply(this, args)
}
syncBuiltinESMExports()
const originalFetch = globalThis.fetch
globalThis.fetch = async function (input, init) {
  let url
  try { url = new URL(input instanceof Request ? input.url : input) } catch { return block() }
  // Next dev metadata stays unavailable offline; never fabricate version/security results.
  if (url.href === 'https://registry.npmjs.org/-/package/next/dist-tags' ||
    url.href === 'https://registry.npmjs.org/-/npm/v1/security/advisories/bulk') {
    let request
    try { request = new Request(input, init) } catch { return block() }
    const noCredentials = !request.headers.has('authorization') && !request.headers.has('cookie') && !request.headers.has('x-api-key')
    if (url.href === 'https://registry.npmjs.org/-/package/next/dist-tags' &&
      request.method === 'GET' && request.body === null && noCredentials) {
      record('development_metadata_denied_next_dist_tags')
      return new Response(null, { status: 503 })
    }
    if (url.href === 'https://registry.npmjs.org/-/npm/v1/security/advisories/bulk' &&
      request.method === 'POST' && noCredentials &&
      await request.text() === JSON.stringify({ next: [require('next/package.json').version] })) {
      record('development_metadata_denied_next_installed_advisories')
      return new Response(null, { status: 503 })
    }
    return block()
  }
  if (!['http:', 'https:'].includes(url.protocol) || !allowed(url.hostname, url.port) || url.username || url.password) return block()
  return originalFetch(input, init)
}
record('preload_ready')
