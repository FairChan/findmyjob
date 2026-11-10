/* Test-process transport guard. Never loaded by production configuration. */
const fs = require('node:fs')
const https = require('node:https')
const { syncBuiltinESMExports } = require('node:module')
if (process.env.ANTHROPIC_API_KEY !== 'SYNTHETIC_T01_NO_EXTERNAL_AI' || !process.env.T01_AI_BLOCK_LOG) {
  throw new Error('T01 synthetic transport configuration required')
}
function check(value) {
  const hostname = typeof value === 'string' || value instanceof URL
    ? new URL(value).hostname : value?.hostname ?? value?.host ?? ''
  if (/(^|\.)anthropic\.com(?::\d+)?$/i.test(hostname)) {
    fs.appendFileSync(process.env.T01_AI_BLOCK_LOG, 'BLOCKED_AI_REQUEST\n')
    throw new Error('External AI is prohibited in T01 UI E2E')
  }
}
const originalFetch = globalThis.fetch
globalThis.fetch = async function (input, init) {
  check(input instanceof Request ? input.url : input)
  return originalFetch(input, init)
}
for (const method of ['request', 'get']) {
  const original = https[method]
  https[method] = function (url, ...args) { check(url); return original.call(this, url, ...args) }
}
syncBuiltinESMExports()
