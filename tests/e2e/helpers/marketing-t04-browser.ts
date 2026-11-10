import { createHash, createHmac, randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import AxeBuilder from '@axe-core/playwright'
import { expect, type Page, type Route, type TestInfo } from '@playwright/test'
import { e2eDb as db } from './db'
import { loginAs } from './session'
import en from '../../../messages/en.json'
import zh from '../../../messages/zh.json'

export const marketingCopy = (locale: 'zh' | 'en') => locale === 'zh' ? zh : en
type Settings = Awaited<ReturnType<typeof readSettings>>
async function readSettings() {
  return db.systemSetting.findMany({ where: { key: { in: ['marketing.weekly', 'legal.currentVersion', 'ai.matching'] } }, orderBy: { key: 'asc' } })
}

export class MarketingBrowserFixture {
  readonly marker = 'M9T04_BROWSER_' + randomUUID().replaceAll('-', '')
  userId = ''
  profileId = ''
  legalVersion = ''
  settings: Settings = []
  private browserBlocked = 0
  private installed = false
  readonly anonymousPosts: Array<{ tokenOnly: boolean; hadCookie: boolean; originRemoved: boolean }> = []
  private readonly directory = process.env.T04_OFFLINE_DIR ?? ''
  private readonly runId = process.env.T04_OFFLINE_RUN_ID ?? ''
  private readonly guardBrowser = async (route: Route) => {
    const request = route.request(), url = new URL(request.url())
    if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || !['http:', 'https:'].includes(url.protocol)) {
      this.browserBlocked++; await route.abort('blockedbyclient'); return
    }
    if (url.pathname === '/api/marketing/unsubscribe' && request.method() === 'POST') {
      const headers = { ...await request.allHeaders() }
      const keys = [...new URLSearchParams(request.postData() ?? '').keys()]
      this.anonymousPosts.push({ tokenOnly: keys.length === 1 && keys[0] === 'token', hadCookie: Boolean(headers.cookie), originRemoved: true })
      // Forward the real browser form to the real route with no ambient authority.
      delete headers.origin; delete headers.cookie
      await route.continue({ headers }); return
    }
    await route.continue()
  }

  constructor(readonly page: Page) {}
  async init(role: 'STUDENT' | 'EMPLOYER', anonymous = false) {
    if (!this.directory || !this.runId || process.env.APP_ENV !== 'ci' ||
      !process.env.T04_SYNTHETIC_SECRET || process.env.MARKETING_UNSUBSCRIBE_SECRET !== process.env.T04_SYNTHETIC_SECRET) {
      throw new Error('Use playwright.t04-ui.config.ts')
    }
    expect((await this.events()).some(event => event.event === 'preload_ready')).toBe(true)
    const disclosure = await readFile('src/server/lib/marketing-disclosure.ts', 'utf8')
    expect(disclosure).toMatch(/const publication:\s*Publication\s*\|\s*null\s*=\s*null/)
    this.settings = await readSettings()
    const gate = this.settings.find(row => row.key === 'marketing.weekly')?.value
    expect(gate == null || typeof gate === 'object' && !Array.isArray(gate) && gate.enabled === false,
      'Requires the existing gate to be absent or explicitly disabled; never enables it').toBe(true)
    const version = this.settings.find(row => row.key === 'legal.currentVersion')?.value
    if (typeof version !== 'string' || !version.length || version.length > 100) throw new Error('Valid existing legal.currentVersion required; fixture does not change settings')
    this.legalVersion = version
    await this.page.context().route('**/*', this.guardBrowser)
    await this.page.context().routeWebSocket(/.*/, route => {
      const url = new URL(route.url())
      if (['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) route.connectToServer()
      else { this.browserBlocked++; route.close() }
    })
    this.installed = true
    if (anonymous) {
      const user = await db.user.create({ data: { name: this.marker, email: this.marker.toLowerCase() + '@example.test', emailVerified: true, role, status: 'ACTIVE' } })
      this.userId = user.id
    } else {
      // Public Turnstile script fixture only; credentials and session are real local auth.
      this.userId = (await loginAs(this.page, { role })).userId
    }
    if (role === 'STUDENT') {
      const profile = await db.studentProfile.create({ data: { userId: this.userId, fullName: this.marker, visibility: anonymous ? 'PUBLIC' : 'HIDDEN',
        onboardingStep: 5, intents: [], preferredStates: [], preferredIndustries: [], skills: [] } })
      this.profileId = profile.id
    }
    await db.consent.createMany({ data: (['TALENT_POOL', 'AI_MATCHING', 'AI_RESUME_PARSE'] as const).map(type => ({
      userId: this.userId, type, version: this.legalVersion, granted: anonymous && type === 'TALENT_POOL',
    })) })
  }

  async seedHistoricalChoice() {
    const [clock] = await db.$queryRaw<Array<{ now: Date }>>`SELECT clock_timestamp() AS "now"`
    const latest = await db.consent.findFirst({ where: { userId: this.userId }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] })
    const at = new Date(Math.max(clock!.now.getTime(), (latest?.createdAt.getTime() ?? 0) + 1))
    const historical = 'historical-' + this.marker
    for (const type of ['TERMS', 'PRIVACY'] as const) await db.consent.create({ data: {
      userId: this.userId, type, version: historical, granted: true, createdAt: at,
    } })
    // A newer historical-version true must win over an older current-version false.
    await db.consent.create({ data: { userId: this.userId, type: 'MARKETING', version: this.legalVersion, granted: false, createdAt: new Date(at.getTime() - 1) } })
    const grant = await db.consent.create({ data: { userId: this.userId, type: 'MARKETING', version: historical, granted: true, createdAt: at } })
    if (this.profileId) {
      const matchingWithdrawal = await db.consent.findFirstOrThrow({
        where: { userId: this.userId, type: 'AI_MATCHING' }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      })
      // A queued delivery references its historical grant; keep the existing
      // newer matching withdrawal and the default-off gate intact.
      const matchingGrant = await db.consent.create({ data: {
        userId: this.userId, type: 'AI_MATCHING', version: historical, granted: true,
        createdAt: new Date(matchingWithdrawal.createdAt.getTime() - 1),
      } })
      const day = 86_400_000, offset = 8 * 3_600_000, local = new Date(at.getTime() + offset)
      const monday = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()) - ((local.getUTCDay() + 6) % 7) * day
      const weekKey = new Date(monday).toISOString().slice(0, 10)
      await db.weeklyDigestDelivery.create({ data: {
        kind: 'STUDENT_JOBS', userId: this.userId, companyId: null, weekKey,
        dedupeKey: createHash('sha256').update(JSON.stringify(['STUDENT_JOBS', this.userId, null, weekKey])).digest('hex'),
        expiresAt: new Date(monday - offset + 7 * day), state: 'QUEUED', marketingGrantId: grant.id, matchingGrantId: matchingGrant.id,
        gateEpoch: randomUUID(), matchingEpoch: randomUUID(), sourceId: this.profileId,
        sourceHash: createHash('sha256').update(this.marker).digest('hex'),
        candidateIds: [this.marker + '_UNSENT'], attempts: 0, nextAttemptAt: at,
      } })
    }
    expect(await readSettings()).toEqual(this.settings)
  }

  async state() {
    const [marketing, otherConsents, profile, deliveries, marketingAudits, visibilityAudits, notifications] = await Promise.all([
      db.consent.findMany({ where: { userId: this.userId, type: 'MARKETING' }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] }),
      db.consent.findMany({ where: { userId: this.userId, type: { not: 'MARKETING' } }, orderBy: { id: 'asc' } }),
      db.studentProfile.findUnique({ where: { userId: this.userId }, select: { id: true, visibility: true, editRevision: true } }),
      db.weeklyDigestDelivery.findMany({ where: { userId: this.userId }, orderBy: { id: 'asc' } }),
      db.auditLog.findMany({ where: { actorId: this.userId, action: 'marketing.consent' }, orderBy: { id: 'asc' } }),
      db.auditLog.findMany({ where: { actorId: this.userId, action: 'student.visibility.change' }, orderBy: { id: 'asc' } }),
      db.notification.count({ where: { userId: this.userId } }),
    ])
    return { marketing, otherConsents, profile, deliveries, marketingAudits, visibilityAudits, notifications }
  }

  async expectWithdrawn(before: Awaited<ReturnType<MarketingBrowserFixture['state']>>) {
    await expect.poll(async () => (await this.state()).marketing.at(-1)?.granted).toBe(false)
    const after = await this.state()
    expect(after.marketing).toHaveLength(before.marketing.length + 1)
    expect(after.marketing.slice(0, -1)).toEqual(before.marketing)
    expect(after.marketing.at(-1)?.version).toBe(this.legalVersion)
    expect(after.otherConsents).toEqual(before.otherConsents)
    expect(after.profile).toEqual(before.profile)
    expect(after.visibilityAudits).toEqual(before.visibilityAudits)
    expect(after.notifications).toBe(before.notifications)
    expect(after.marketingAudits).toHaveLength(before.marketingAudits.length + 1)
    expect(after.deliveries).toHaveLength(before.deliveries.length)
    for (const delivery of after.deliveries) {
      expect(delivery).toMatchObject({ state: 'SKIPPED', failureCode: 'AUTHORIZATION_CHANGED',
        nextAttemptAt: null, leaseToken: null, leaseExpiresAt: null, candidateIds: [], sentAt: null, attempts: 0 })
    }
    expect(await readSettings()).toEqual(this.settings)
    return after
  }

  token() {
    const payload = Buffer.from(this.userId).toString('base64url')
    // Fixture encoding of the public v1 format; the real route/service verify the signature.
    const signature = createHmac('sha256', process.env.T04_SYNTHETIC_SECRET!).update('marketing-unsubscribe:v1.' + payload).digest('base64url')
    return payload + '.' + signature
  }
  async events(): Promise<Array<{ runId: string; event: string }>> {
    const text = await readFile(join(this.directory, 'events.jsonl'), 'utf8')
    return text.trim().split('\n').filter(Boolean).map(line => JSON.parse(line) as { runId: string; event: string })
  }
  async cleanup(info: TestInfo) {
    try {
      if (this.userId) {
        // Preserve append-only consent/audit evidence; neutralize only this synthetic actor.
        await db.weeklyDigestDelivery.updateMany({ where: { userId: this.userId, state: 'QUEUED' },
          data: { state: 'SKIPPED', failureCode: 'SYNTHETIC_TEST_CLEANUP', nextAttemptAt: null, candidateIds: [] } })
        await db.session.deleteMany({ where: { userId: this.userId } })
        await db.account.deleteMany({ where: { userId: this.userId } })
        await db.user.update({ where: { id: this.userId }, data: { status: 'SUSPENDED' } })
      }
      if (this.settings.length) expect(await readSettings()).toEqual(this.settings)
    } finally {
      if (this.installed) await this.page.context().unroute('**/*', this.guardBrowser)
    }
    const events = await this.events()
    await info.attach('offline-events', { body: JSON.stringify(events), contentType: 'application/json' })
    expect(events.every(event => event.runId === this.runId && ['preload_ready', 'development_metadata_denied_next_dist_tags', 'development_metadata_denied_next_installed_advisories'].includes(event.event))).toBe(true)
    expect(this.browserBlocked).toBe(0)
  }
}

export async function marketingEvidence(page: Page, info: TestInfo, label: string, publicDocument = false) {
  for (const width of [375, 1280]) {
    await page.setViewportSize({ width, height: 900 })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2)).toBe(true)
    const builder = new AxeBuilder({ page })
    // Authenticated app chrome is covered elsewhere; the public HTML route is checked in full.
    const result = await (publicDocument ? builder : builder.include('[data-testid="marketing-preferences"]')).analyze()
    const input = page.locator('input[name="token"]')
    const token = publicDocument && await input.count() ? await input.getAttribute('value') : null
    const serialized = JSON.stringify(result, null, 2)
    const safe = token ? serialized.split(token).join('[REDACTED]') : serialized
    await info.attach(label + '-' + width + '-axe', { body: safe, contentType: 'application/json' })
    expect(JSON.parse(safe).violations).toEqual([])
    const file = info.outputPath(label + '-' + width + '.png')
    await page.screenshot({ path: file, fullPage: true })
    await info.attach(label + '-' + width, { path: file, contentType: 'image/png' })
  }
}

export function nextMarketingAction(page: Page) {
  const pathname = new URL(page.url()).pathname
  return page.waitForResponse(response => response.request().method() === 'POST' &&
    Boolean(response.request().headers()['next-action']) && new URL(response.url()).pathname === pathname)
}
