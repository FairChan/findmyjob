import { browser } from 'k6/browser'
import http from 'k6/http'
import { Counter, Trend } from 'k6/metrics'
import { verifySessionPreflight } from './session-preflight.mjs'

if (__ENV.LOAD_RUN_DIR !== '/run') throw new Error('Runner-owned private manifest required')
const manifest = JSON.parse(open('/run/manifest.json'))
const origin = manifest.browserBaseURL || manifest.baseURL
const coordinator = `${__ENV.LOAD_COORDINATOR}/${manifest.runId}`
const completed = new Counter('mutation_completed')
const failures = new Counter('mutation_failures')
const attempted = new Counter('mutation_attempted')
const transportRetries = new Counter('coordinator_transport_retries')
const sessionPreflightRetries = new Counter('session_preflight_transport_retries')
const latency = new Trend('mutation_ui_duration', true) // UI diagnostics, not the old HTTP p95 budget.
// k6 globals are per VU. This checks signing/transport configuration once; each
// fresh page and Server Action still authenticates its own scheduled student.
let sessionConfigurationVerified = false
const pause = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds))

async function report(event, scenario, slot, data = {}) {
  const body = JSON.stringify({ event, scenario, slot, ...data })
  const replayable = event === 'started' || event === 'completed'
  transportRetries.add(0)
  for (let attempt = 0; attempt < (replayable ? 3 : 1); attempt++) {
    const response = await http.asyncRequest('POST', coordinator, body, {
      headers: { 'Content-Type': 'application/json' }, timeout: event === 'ready' ? '60s' : '5s', tags: { name: 'runner_coordinator' },
    })
    if (response.status === 200) return response.json()
    // Only identical bookkeeping events may be replayed after an unknown transport
    // result. UI mutations, barriers, clicks and explicit rejections are never retried.
    if (!replayable || response.status !== 0 || attempt === 2) throw new Error(`Coordinator rejected ${event}/${scenario}/${slot} (HTTP ${response.status}, error ${response.error_code})`)
    transportRetries.add(1)
    await pause(100 * (attempt + 1))
  }
  throw new Error('Coordinator acknowledgement unavailable')
}
async function awaitRelease(scenario, slot) {
  const release = await report('ready', scenario, slot)
  if (!release.released || !Number.isFinite(release.releaseAt)) throw new Error('Readiness barrier not released')
  const wait = release.releaseAt - Date.now()
  if (wait < 0) throw new Error('Client missed future release epoch')
  await pause(wait)
}
async function sessionPage(account, path, role) {
  if (!sessionConfigurationVerified) {
    sessionPreflightRetries.add(0)
    await verifySessionPreflight({ request: (...args) => http.asyncRequest(...args), pause,
      onRetry: () => sessionPreflightRetries.add(1), url: `${origin}/api/auth/get-session`,
      cookie: account.cookie.header, userId: account.userId, role })
    sessionConfigurationVerified = true
  }
  const context = await browser.newContext()
  let page
  try {
    const c = account.cookie
    await context.addCookies([{ name: c.name, value: c.value, domain: origin.split('/')[2].split(':')[0], path: c.attributes.path || '/', httpOnly: !!c.attributes.httpOnly, secure: !!c.attributes.secure, sameSite: 'Lax' }])
    page = await context.newPage()
    await page.goto(`${origin}${path}`, { waitUntil: 'networkidle', timeout: 60000 })
    if (page.url() !== `${origin}${path}`) throw new Error(page.url().includes('/legal/reconsent') ? 'Stale legal consent' : 'Unexpected route after navigation')
    return { context, page }
  } catch (error) {
    const route = page ? page.url() : ''
    await context.close()
    if (route.includes('/legal/reconsent')) throw new Error('Stale legal consent')
    throw error
  }
}
// v0.54 has CSS locators but no getByRole/nth. Observe the actual labeled button,
// construct its CSS path, then use the browser's real click (never call an action in evaluate).
async function button(page, label) {
  const selector = await page.evaluate(text => {
    const matches = Array.from(document.querySelectorAll('button')).filter(el => el.textContent.trim() === text && el.getClientRects().length)
    if (matches.length !== 1) return null
    const parts = []
    for (let el = matches[0]; el && el !== document.body; el = el.parentElement) {
      parts.unshift(`${el.tagName.toLowerCase()}:nth-child(${Array.from(el.parentElement.children).indexOf(el) + 1})`)
    }
    return `body > ${parts.join(' > ')}`
  }, label)
  if (!selector) throw new Error(`Expected one visible ${label} button`)
  return page.locator(selector)
}
async function terminal(page, kind) {
  const until = Date.now() + 60000
  while (Date.now() < until) {
    const state = await page.evaluate(type => {
      const visible = el => el.getClientRects().length > 0
      const alert = Array.from(document.querySelectorAll('[role="alert"]')).find(visible)
      if (alert) return alert.textContent.includes('Insufficient credits') ? 'insufficient_credits' : 'unexpected'
      const text = Array.from(document.querySelectorAll('span')).filter(visible).map(el => el.textContent.trim())
      if (type === 'unlock' && text.includes('Unlocked')) return 'unlocked'
      if (type === 'apply' && text.some(value => value === '✓ Applied')) return 'applied'
      return null
    }, kind)
    if (state) return state
    await pause(100)
  }
  throw new Error('No terminal business UI result within deadline')
}
async function journey(scenario, slot, work, pair) {
  let context
  let outcome = 'unexpected'
  let uiDurationMs = 0
  let failure
  let started = false
  attempted.add(1)
  failures.add(0)
  try {
    await report('started', scenario, slot)
    started = true
    const result = await work(value => { context = value })
    outcome = result.outcome; uiDurationMs = result.uiDurationMs
    if (!['unlocked', 'insufficient_credits', 'applied'].includes(outcome)) throw new Error('Unexpected terminal UI')
  } catch (error) {
    failure = error
  } finally {
    try { if (context) await context.close() } catch (error) { failure = failure || error }
    try {
      if (started) await report('completed', scenario, slot, { outcome, uiDurationMs, ...(pair ? { studentId: pair.studentId, jobId: pair.jobId, companyId: pair.companyId } : {}) })
    } catch (error) { failure = failure || error }
  }
  if (failure) {
    failures.add(1)
    console.error(`${scenario}/${slot}: ${String(failure?.message ?? failure).slice(0, 180)}`)
  } else { latency.add(uiDurationMs, { scenario }); completed.add(1) }
}
export async function runUnlock(scenario, slot) {
  const fixture = manifest[scenario]
  await journey(scenario, slot, async own => {
    const id = __ENV.LOAD_NEGATIVE === 'missing-target' && slot === 0 ? 'missing-load-target' : scenario === 'balanceRace' ? fixture.studentIds[slot] : fixture.studentId
    const { context, page } = await sessionPage(fixture.account, `/en/e/talent/${id}`, 'EMPLOYER')
    own(context)
    await page.locator('[data-testid="unlock-button"]').click({ timeout: 15000 })
    const confirm = await button(page, 'Confirm Unlock')
    if (__ENV.LOAD_NEGATIVE === 'unready' && slot === 0) throw new Error('Controlled unready client')
    await awaitRelease(scenario, slot)
    const started = Date.now()
    await confirm.click()
    await report('clicked', scenario, slot)
    return { outcome: await terminal(page, 'unlock'), uiDurationMs: Date.now() - started }
  })
}
export async function runApply(scenario, slot) {
  const pair = scenario === 'duplicateApply' ? manifest.duplicateApplyPair : manifest.applyPairs[slot]
  if (!pair) { failures.add(1); throw new Error('Fresh application schedule exhausted') }
  await journey(scenario, slot, async own => {
    const { context, page } = await sessionPage(pair.account, `/en/jobs/${pair.jobId}`, 'STUDENT')
    own(context)
    await (await button(page, 'Apply Now')).click()
    const submit = await button(page, 'Submit Application')
    if (scenario === 'duplicateApply') await awaitRelease(scenario, slot)
    const started = Date.now()
    await submit.click()
    if (scenario === 'duplicateApply') await report('clicked', scenario, slot)
    return { outcome: await terminal(page, 'apply'), uiDurationMs: Date.now() - started }
  }, pair)
  await pause(500)
}
