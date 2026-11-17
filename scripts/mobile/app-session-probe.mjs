// Usage: BASE=http://localhost:3030 node scripts/mobile/app-session-probe.mjs  (needs Mailpit on 8026; local only)
// MA1-T02 runtime probe: behaves like the Android app (@better-auth/expo client):
// keeps Better Auth cookies itself, sends them with expo-origin, never sends Origin.
// Synthetic data only (example.test). Target: local isolated dev server on 3030.
const BASE = process.env.BASE ?? 'http://localhost:3030'
const APP_ORIGIN = 'findmyjob-dev://'
const MAILPIT = 'http://127.0.0.1:8026'
// Cloudflare's always-pass test token; works only with the test secret from env.example
const TURNSTILE_TEST_TOKEN = 'XXXX.DUMMY.TOKEN.XXXX'
const email = `mobile-probe-${Date.now()}@example.test`
const password = `Probe-${Math.random().toString(36).slice(2)}-Aa1!`

const jar = new Map()
const results = []
function check(name, pass, detail = '') {
  results.push({ name, pass, detail })
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`)
}
function storeCookies(res) {
  for (const sc of res.headers.getSetCookie?.() ?? []) {
    const [pair, ...attrs] = sc.split(';')
    const eq = pair.indexOf('=')
    const name = pair.slice(0, eq).trim()
    const value = pair.slice(eq + 1).trim()
    const expired = attrs.some((a) => /max-age=0/i.test(a)) || value === ''
    if (expired) jar.delete(name)
    else jar.set(name, value)
  }
}
const cookieHeader = () => [...jar].map(([k, v]) => `${k}=${v}`).join('; ')

async function app(path, { method = 'GET', body, headers = {} } = {}) {
  const res = await fetch(BASE + path, {
    method,
    redirect: 'manual',
    headers: {
      'expo-origin': APP_ORIGIN,
      'x-app-version': '0.1.0',
      ...(jar.size ? { cookie: cookieHeader() } : {}),
      ...(body ? { 'content-type': 'application/json' } : {}),
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  storeCookies(res)
  let json = null
  try { json = await res.clone().json() } catch {}
  return { res, json }
}

// 1. sign-up from the app
let r = await app('/api/auth/sign-up/email', {
  method: 'POST',
  body: { email, password, name: 'Mobile Probe', agreeTerms: true, agreePrivacy: true, turnstileToken: TURNSTILE_TEST_TOKEN },
})
check('sign-up via expo-origin', r.res.ok, `status ${r.res.status} ${JSON.stringify(r.json)?.slice(0, 120)}`)
check('sign-up response has no set-auth-token', !r.res.headers.has('set-auth-token'))

// 2. email verification: the web flow is a link (OTP verify is a disabled path). On the phone the
// student taps the link (browser, or App Links later) and then signs in inside the app.
async function verificationLink(addr) {
  for (let i = 0; i < 30; i++) {
    const r = await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${addr}"`)}`)
    const data = await r.json()
    for (const m of data.messages ?? []) {
      const full = await (await fetch(`${MAILPIT}/api/v1/message/${m.ID}`)).json()
      const link = /(https?:\/\/[^\s"'<>]+\/api\/auth\/verify-email\?[^\s"'<>]+)/.exec(`${full.Text ?? ''} ${full.HTML ?? ''}`)?.[1]
      if (link) return link.replace(/&amp;/g, '&')
    }
    await new Promise((r) => setTimeout(r, 500))
  }
  return null
}
const link = await verificationLink(email)
check('verification link arrived in Mailpit', !!link)
{
  const res = await fetch(link, { redirect: 'manual' })
  check('verification link accepted (browser tap)', res.status >= 200 && res.status < 400, `status ${res.status}`)
}


// 3. sign-in, cookie captured by the app itself
jar.clear()
r = await app('/api/auth/sign-in/email', { method: 'POST', body: { email, password, turnstileToken: TURNSTILE_TEST_TOKEN } })
const sessionCookie = [...jar.keys()].find((k) => k.includes('better-auth.session_token'))
check('sign-in via expo-origin', r.res.ok, `status ${r.res.status}`)
check('session cookie captured from Set-Cookie', !!sessionCookie, sessionCookie ?? 'none')
check('sign-in response has no set-auth-token', !r.res.headers.has('set-auth-token'))

// 4. session + mobile API with the stored cookie
r = await app('/api/auth/get-session')
check('get-session returns the user', r.json?.user?.email === email)
r = await app('/api/m/v1/me')
check('/api/m/v1/me with app origin', r.res.status === 200 && r.json?.data?.email === email && r.json?.data?.role === 'STUDENT', `status ${r.res.status}`)
check('/api/m/v1/me is private no-store', r.res.headers.get('cache-control') === 'private, no-store')
r = await app('/api/m/v1/config')
check('/api/m/v1/config with app origin', r.res.status === 200 && typeof r.json?.data?.minSupportedVersion === 'string')

// 5. same cookie, browser origins → rejected
for (const origin of [BASE, 'https://evil.example']) {
  const res = await fetch(BASE + '/api/m/v1/me', { headers: { origin, cookie: cookieHeader(), 'x-app-version': '0.1.0' } })
  check(`/api/m/v1/me with browser Origin ${origin} → 403`, res.status === 403, `status ${res.status}`)
}
{
  const res = await fetch(BASE + '/api/m/v1/me', { headers: { cookie: cookieHeader(), 'x-app-version': '0.1.0' } })
  check('/api/m/v1/me without any origin → 403', res.status === 403, `status ${res.status}`)
}
{
  const res = await fetch(BASE + '/api/m/v1/me', { headers: { 'expo-origin': 'findmyjob-dev-evil://', cookie: cookieHeader(), 'x-app-version': '0.1.0' } })
  check('/api/m/v1/me with look-alike scheme → 403', res.status === 403, `status ${res.status}`)
}
{
  const res = await fetch(BASE + '/api/m/v1/me', { headers: { 'expo-origin': APP_ORIGIN, cookie: cookieHeader() } })
  check('/api/m/v1/me without version header → 426', res.status === 426, `status ${res.status}`)
}
{
  const res = await fetch(BASE + '/api/m/v1/config', { headers: { 'expo-origin': APP_ORIGIN, 'x-app-version': '0.1.0' } })
  check('/api/m/v1/config works without a session (proxy exemption)', res.status === 200, `status ${res.status}`)
}

// 6. custom-scheme callbackURL is refused
r = await app('/api/auth/send-verification-email', {
  method: 'POST',
  body: { email, callbackURL: 'findmyjob-dev://verified', turnstileToken: TURNSTILE_TEST_TOKEN },
})
check('custom-scheme callbackURL rejected', r.res.status === 400 && /INVALID_CALLBACK_URL/.test(JSON.stringify(r.json)), `status ${r.res.status} ${JSON.stringify(r.json)?.slice(0, 100)}`)

// 7. web sign-in (browser Origin) exposes no set-auth-token
{
  const res = await fetch(BASE + '/api/auth/sign-in/email', {
    method: 'POST',
    headers: { origin: BASE, 'content-type': 'application/json' },
    body: JSON.stringify({ email, password, turnstileToken: TURNSTILE_TEST_TOKEN }),
  })
  check('web sign-in still works', res.ok, `status ${res.status}`)
  check('web sign-in response has no set-auth-token', !res.headers.has('set-auth-token'))
}

// 8. sign-out from the app revokes the session
r = await app('/api/auth/sign-out', { method: 'POST', body: {} })
check('sign-out via expo-origin', r.res.ok, `status ${r.res.status}`)
{
  const stale = sessionCookie ? `${sessionCookie}=${jar.get(sessionCookie) ?? ''}` : ''
  const res = await fetch(BASE + '/api/m/v1/me', { headers: { 'expo-origin': APP_ORIGIN, 'x-app-version': '0.1.0', cookie: stale } })
  check('after sign-out /api/m/v1/me is refused', res.status === 401 || res.status === 403, `status ${res.status}`)
}

const failed = results.filter((x) => !x.pass)
console.log(`\n${results.length - failed.length}/${results.length} passed`)
process.exit(failed.length ? 1 : 0)
