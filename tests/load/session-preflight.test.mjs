import assert from 'node:assert/strict'
import test from 'node:test'
import { verifySessionPreflight } from '../../load/k6/lib/session-preflight.mjs'

const valid = () => ({ status: 200, json: () => ({ user: { id: 'expected-user', role: 'STUDENT' } }) })
function fixture(responses) {
  const calls = [], waits = [], retries = []
  return { calls, waits, retries, options: {
    url: 'http://synthetic.test/api/auth/get-session', cookie: 'synthetic=same-cookie', userId: 'expected-user', role: 'STUDENT',
    request: async (...args) => { calls.push(args); return responses.shift() },
    pause: async ms => { waits.push(ms) }, onRetry: () => { retries.push(1) },
  } }
}
test('HTTP 0 retries the same bounded GET then validates exact identity', async () => {
  const f = fixture([{ status: 0 }, valid()])
  await verifySessionPreflight(f.options)
  assert.equal(f.calls.length, 2)
  assert.deepEqual(f.calls[0], f.calls[1])
  assert.equal(f.calls[0][0], 'GET')
  assert.equal(f.calls[0][3].timeout, '5s')
  assert.equal(f.calls[0][3].redirects, 0)
  assert.equal(f.calls[0][3].headers.Cookie, 'synthetic=same-cookie')
  assert.deepEqual(f.waits, [100])
  assert.equal(f.retries.length, 1)
})
test('three HTTP 0 results exhaust without accepting a session', async () => {
  const f = fixture([{ status: 0 }, { status: 0 }, { status: 0 }])
  await assert.rejects(verifySessionPreflight(f.options), /transport.*exhausted/i)
  assert.equal(f.calls.length, 3)
  assert.deepEqual(f.waits, [100, 200])
})
for (const status of [302, 401, 403, 429, 500]) test(`HTTP ${status} fails without retry`, async () => {
  const f = fixture([{ status }])
  await assert.rejects(verifySessionPreflight(f.options), /rejected.*HTTP/)
  assert.equal(f.calls.length, 1)
  assert.equal(f.retries.length, 0)
})
for (const response of [
  { status: 200, json: () => null },
  { status: 200, json: () => ({ user: { id: 'wrong', role: 'STUDENT' } }) },
  { status: 200, json: () => ({ user: { id: 'expected-user', role: 'EMPLOYER' } }) },
  { status: 200, json: () => { throw new SyntaxError('invalid private response') } },
]) test('invalid 200 session fails immediately without retry', async () => {
  const f = fixture([response])
  await assert.rejects(verifySessionPreflight(f.options), /Session preflight rejected/)
  assert.equal(f.calls.length, 1)
  assert.equal(f.retries.length, 0)
})
