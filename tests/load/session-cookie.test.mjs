import assert from 'node:assert/strict'
import { access } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import test from 'node:test'

const root = fileURLToPath(new URL('../../', import.meta.url))
const requireFromProject = createRequire(resolve(root, 'package.json'))
const projectImport = name => import(pathToFileURL(requireFromProject.resolve(name)).href)

async function subject() {
  const target = resolve(root, 'scripts/load/session-cookie.ts')
  await assert.doesNotReject(access(target), 'Missing thin shared session-cookie helper (expected initial RED)')
  return import(pathToFileURL(target).href)
}

test('requires caller-provided secret and baseURL before a caller can create sessions', async () => {
  const { requireLoadSessionOptions } = await subject()
  assert.throws(() => requireLoadSessionOptions({ baseURL: 'http://127.0.0.1:3991' }), /secret/i)
  assert.throws(() => requireLoadSessionOptions({ secret: 'synthetic-load-session-secret-at-least-32-bytes' }), /baseURL/i)
})

test('uses installed cookie metadata for HTTP and HTTPS and retains a legacy Cookie header', async () => {
  const { requireLoadSessionOptions, createLoadSessionCookie } = await subject()
  const { getCookies } = await projectImport('better-auth/cookies')
  for (const baseURL of ['http://127.0.0.1:3991', 'https://synthetic.example.test']) {
    const options = requireLoadSessionOptions({
      secret: 'synthetic-load-session-secret-at-least-32-bytes', baseURL,
    })
    const cookie = await createLoadSessionCookie('synthetic-token', options)
    const expected = getCookies(options).sessionToken
    assert.equal(cookie.name, expected.name)
    assert.deepEqual(cookie.attributes, expected.attributes)
    assert.equal(cookie.header, `${cookie.name}=${cookie.value}`)
    assert.match(decodeURIComponent(cookie.value), /^synthetic-token\..+$/)
  }
})

test('installed Better Auth accepts the signed cookie but rejects the old raw-token form', async () => {
  const { requireLoadSessionOptions, createLoadSessionCookie } = await subject()
  const { betterAuth } = await projectImport('better-auth')
  const { memoryAdapter } = await projectImport('better-auth/adapters/memory')
  const now = new Date()
  const token = 'synthetic-session-token-for-installed-auth-regression'
  const userId = 'synthetic-load-user'
  const options = requireLoadSessionOptions({
    secret: 'synthetic-load-session-secret-at-least-32-bytes', baseURL: 'http://127.0.0.1:3991',
  })
  const auth = betterAuth({
    ...options,
    database: memoryAdapter({
      user: [{ id: userId, email: 'load@example.test', name: 'Synthetic', emailVerified: true, createdAt: now, updatedAt: now }],
      session: [{ id: 'synthetic-session', userId, token, expiresAt: new Date(now.getTime() + 3_600_000), createdAt: now, updatedAt: now }],
      account: [], verification: [],
    }),
    session: { cookieCache: { enabled: false } },
    rateLimit: { enabled: false },
    telemetry: { enabled: false },
    logger: { level: 'error' },
  })
  const cookie = await createLoadSessionCookie(token, options)
  const signed = await auth.api.getSession({ headers: new Headers({ cookie: cookie.header }) })
  assert.equal(signed?.user.id, userId, 'A cookie-shaped string is insufficient; real getSession must resolve the row')
  const unsigned = await auth.api.getSession({ headers: new Headers({ cookie: `${cookie.name}=${token}` }) })
  assert.equal(unsigned, null, 'Control must reproduce the legacy unsigned-cookie rejection')
})

test('rejects unsuitable explicit settings without consulting environment defaults', async () => {
  const { requireLoadSessionOptions } = await subject()
  for (const secret of ['', '   ', 'short']) {
    assert.throws(() => requireLoadSessionOptions({ secret, baseURL: 'http://127.0.0.1:3991' }), /secret/i)
  }
  for (const baseURL of ['', '/relative', 'ftp://synthetic.example.test', 'not a URL']) {
    assert.throws(() => requireLoadSessionOptions({ secret: 'synthetic-load-session-secret-at-least-32-bytes', baseURL }), /baseURL/i)
  }
})

test('retains caller-supplied advanced cookie metadata and encodes the signature once', async () => {
  const { requireLoadSessionOptions, createLoadSessionCookie } = await subject()
  const { getCookies } = await projectImport('better-auth/cookies')
  const { makeSignature } = await projectImport('better-auth/crypto')
  const options = requireLoadSessionOptions({
    secret: 'synthetic-load-session-secret-at-least-32-bytes',
    baseURL: 'https://synthetic.example.test',
    advanced: {
      useSecureCookies: false,
      cookiePrefix: 'synthetic',
      cookies: { session_token: { name: 'custom-session', attributes: { path: '/custom', sameSite: 'strict' } } },
    },
  })
  const cookie = await createLoadSessionCookie('synthetic-token', options)
  assert.deepEqual({ name: cookie.name, attributes: cookie.attributes }, getCookies(options).sessionToken)
  assert.equal(cookie.value, encodeURIComponent(`synthetic-token.${await makeSignature('synthetic-token', options.secret)}`))
  assert.equal(cookie.header, `${cookie.name}=${cookie.value}`)
})
