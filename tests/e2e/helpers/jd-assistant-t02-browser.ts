import { randomUUID } from 'node:crypto'
import { readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { Prisma } from '@prisma/client'
import AxeBuilder from '@axe-core/playwright'
import { expect, type Page, type Route, type TestInfo } from '@playwright/test'
import { e2eDb as db } from './db'
import { loginAs } from './session'
import en from '../../../messages/en.json'
import zh from '../../../messages/zh.json'

export const jdCopy = (locale: 'zh' | 'en') => locale === 'zh' ? zh : en
export const generatedJd = { zh: '合成岗位建议：整理支持资料并协作处理咨询。', en: 'Synthetic role suggestion: organise support material and help answer enquiries.' }
export const editedJd = { zh: '人工核对后的合成职责：整理支持资料。', en: 'Human-reviewed synthetic duties: organise support material.' }
type GateSnapshot = { value: Prisma.JsonValue; updatedAt: Date; updatedById: string | null } | null
type TransportEvent = { runId: string; event: string; requestId?: string }

export class JdBrowserFixture {
  readonly marker = 'M9T02_BROWSER_' + randomUUID().replaceAll('-', '').slice(0,12)
  readonly title = this.marker + ' support intern'
  readonly points = 'SYNTHETIC duties: organise support material and answer enquiries.'
  readonly originalDescription = this.marker + ' original manual job description.'
  readonly requests: string[] = []
  userId = ''
  companyId = ''
  private snapshot: GateSnapshot = null
  private touched = false
  private browserBlocked = 0
  private routeInstalled = false
  private readonly directory = process.env.T02_AI_FIXTURE_DIR ?? ''
  private readonly runId = process.env.T02_AI_RUN_ID ?? ''
  private readonly guardBrowser = async (route: Route) => {
    const url = new URL(route.request().url())
    if (['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) && ['http:', 'https:'].includes(url.protocol)) {
      await route.continue()
    } else { this.browserBlocked++; await route.abort('blockedbyclient') }
  }

  constructor(readonly page: Page) {}

  async init() {
    if (process.env.ANTHROPIC_API_KEY !== 'SYNTHETIC_T02_NO_EXTERNAL_AI' || process.env.AI_MODEL_JD !== 'synthetic-t02-jd-model' || !this.directory || !this.runId) {
      throw new Error('Use playwright.t02-success.config.ts')
    }
    expect((await this.events()).some(event => event.event === 'preload_ready')).toBe(true)
    expect(await db.resumeParseDraft.count({ where: { state: { in: ['QUEUED', 'PROCESSING'] } } })).toBe(0)
    this.snapshot = await db.systemSetting.findUnique({ where: { key: 'ai.jdAssistant' }, select: { value: true, updatedAt: true, updatedById: true } })
    const baseline = this.snapshot?.value
    expect(baseline == null || typeof baseline === 'object' && !Array.isArray(baseline) && baseline.enabled === false,
      'Refusing to replace an enabled or invalid JD gate').toBe(true)
    const legal = (await db.systemSetting.findUnique({ where: { key: 'legal.currentVersion' } }))?.value ?? '2026-11-draft'
    if (typeof legal !== 'string' || !legal.length || legal.length > 100) throw new Error('Valid current legal version required')
    for (const [key, fallback] of [['limits.aiJdPerUserPerHour', 10], ['limits.aiJdPerCompanyPerHour', 30]] as const) {
      const value = (await db.systemSetting.findUnique({ where: { key } }))?.value ?? fallback
      if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 1000) throw new Error('Valid JD limits required')
    }
    await this.page.route('**/*', this.guardBrowser)
    this.routeInstalled = true
    // Existing helper stubs only the public Turnstile browser script and uses real sign-in.
    const actor = await loginAs(this.page, { role: 'EMPLOYER', company: { verificationStatus: 'UNSUBMITTED', memberRole: 'RECRUITER' } })
    this.userId = actor.userId
    this.companyId = actor.companyId!
    this.touched = true
    const value = { enabled: true, legalVersion: legal, epoch: randomUUID() }
    await db.systemSetting.upsert({ where: { key: 'ai.jdAssistant' }, create: { key: 'ai.jdAssistant', value }, update: { value } })
  }

  async createManualDraft(locale: 'zh' | 'en') {
    const copy = jdCopy(locale)
    const response = await this.page.goto('/' + locale + '/e/jobs/new')
    expect(response?.status()).toBe(200)
    await this.page.waitForLoadState('networkidle')
    // The old title/requirements labels are not associated; use their existing unique placeholders.
    await this.page.getByPlaceholder(copy.jobs.form.titlePlaceholder, { exact: true }).fill(this.title)
    await this.page.getByRole('textbox', { name: copy.jobs.form.descriptionLabel, exact: true }).fill(this.originalDescription)
    await this.page.getByPlaceholder(copy.jobs.form.requirementsPlaceholder, { exact: true }).fill('SYNTHETIC original requirements')
    await this.page.getByPlaceholder(copy.jobs.form.benefitsPlaceholder, { exact: true }).fill('SYNTHETIC original benefits')
    await this.page.getByRole('button', { name: copy.jobs.form.saveDraft, exact: true }).click()
    await this.page.waitForURL(new RegExp('/' + locale + '/e/jobs/[^/]+/edit$'))
    await this.page.waitForLoadState('networkidle')
    const job = await db.job.findFirstOrThrow({ where: { companyId: this.companyId, title: this.title } })
    expect(job).toMatchObject({ status: 'DRAFT', description: this.originalDescription, createdById: this.userId })
    await expect(this.page.getByRole('button', { name: copy.jobs.form.submitReview, exact: true })).toHaveCount(0)
    return job
  }

  async plan(hold = false, output = generatedJd) {
    const requestId = randomUUID()
    this.requests.push(requestId)
    const temporary = join(this.directory, requestId + '.plan.tmp')
    await writeFile(temporary, JSON.stringify({ runId: this.runId, requestId, title: this.title, points: this.points, output, hold }))
    await rename(temporary, join(this.directory, 'plan.json'))
    return requestId
  }

  async events(): Promise<TransportEvent[]> {
    try {
      const text = await readFile(join(this.directory, 'events.jsonl'), 'utf8')
      return text.trim().split('\n').filter(Boolean).map(line => JSON.parse(line) as TransportEvent)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
      throw error
    }
  }

  async received(requestId: string) {
    await expect.poll(async () => (await this.events()).filter(event => event.requestId === requestId && event.event === 'accepted').length, { timeout: 15_000 }).toBe(1)
  }
  async release(requestId: string) {
    if (!this.requests.includes(requestId)) throw new Error('Unowned synthetic request')
    await writeFile(join(this.directory, requestId + '.release'), '')
  }
  async completed(requestId: string) {
    await expect.poll(async () => (await this.events()).filter(event => event.requestId === requestId && event.event === 'returned').length, { timeout: 15_000 }).toBe(1)
    await expect.poll(() => db.auditLog.count({ where: { actorId: this.userId, action: 'ai.jd.generate' } }), { timeout: 15_000 }).toBe(1)
    const audit = await db.auditLog.findFirstOrThrow({ where: { actorId: this.userId, action: 'ai.jd.generate' } })
    expect(audit.metadata).toEqual({ companyId: this.companyId, outcome: 'success', schemaVersion: 1, promptVersion: 'jd-assistant-v1' })
    const buckets = await db.rateLimitBucket.findMany({ where: { key: { in: ['ai-jd:user:' + this.userId, 'ai-jd:company:' + this.companyId] } } })
    expect(buckets).toHaveLength(2)
    expect(buckets.map(bucket => bucket.count)).toEqual([1, 1])
  }

  async state() {
    const [jobs, totalJobs, jobAudits, applicationEvents, wallets, ledgerEntries, notifications, consents] = await Promise.all([
      db.job.findMany({ where: { companyId: this.companyId }, orderBy: { id: 'asc' } }),
      db.job.count(),
      db.auditLog.count({ where: { targetType: 'Job' } }),
      db.applicationEvent.count(),
      db.creditWallet.findMany({ where: { companyId: this.companyId }, orderBy: { id: 'asc' } }),
      db.creditLedger.count(),
      db.notification.count(),
      db.consent.findMany({ where: { userId: this.userId }, orderBy: { id: 'asc' } }),
    ])
    // No JobEvent model exists: actual event surfaces are Job audit records and ApplicationEvent.
    return { jobs, totalJobs, jobAudits, applicationEvents, wallets, ledgerEntries, notifications, consents }
  }

  async cleanup(info: TestInfo) {
    try {
      for (const requestId of this.requests) await this.release(requestId)
      const accepted = (await this.events()).filter(event => event.event === 'accepted' && this.requests.includes(event.requestId ?? ''))
      for (const event of accepted) {
        await expect.poll(async () => (await this.events()).some(item => item.requestId === event.requestId && ['returned', 'aborted', 'hold_timeout'].includes(item.event)), { timeout: 17_000 }).toBe(true)
      }
      if (!this.page.isClosed()) await this.page.waitForLoadState('networkidle', { timeout: 17_000 })
    } finally {
      try {
        if (this.touched) {
          if (this.snapshot) {
            const data = { ...this.snapshot, value: this.snapshot.value === null ? Prisma.JsonNull : this.snapshot.value }
            await db.systemSetting.upsert({ where: { key: 'ai.jdAssistant' }, create: { key: 'ai.jdAssistant', ...data }, update: data })
          } else await db.systemSetting.deleteMany({ where: { key: 'ai.jdAssistant' } })
          expect(await db.systemSetting.findUnique({ where: { key: 'ai.jdAssistant' }, select: { value: true, updatedAt: true, updatedById: true } })).toEqual(this.snapshot)
        }
      } finally {
        if (this.userId) {
          await db.session.deleteMany({ where: { userId: this.userId } })
          await db.account.deleteMany({ where: { userId: this.userId } })
          await db.user.updateMany({ where: { id: this.userId }, data: { status: 'SUSPENDED' } })
        }
        if (this.companyId) await db.company.updateMany({ where: { id: this.companyId }, data: { isActive: false } })
        if (this.routeInstalled && !this.page.isClosed()) await this.page.unroute('**/*', this.guardBrowser)
      }
    }
    const events = await this.events()
    await info.attach('synthetic-http-events', { body: JSON.stringify(events, null, 2), contentType: 'application/json' })
    expect(events.every(event => event.runId === this.runId)).toBe(true)
    expect(events.filter(event => ['blocked', 'hold_timeout'].includes(event.event))).toEqual([])
    expect(this.browserBlocked).toBe(0)
  }
}

export async function jdEvidence(page: Page, info: TestInfo, label: string) {
  for (const width of [375, 1280]) {
    await page.setViewportSize({ width, height: 900 })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2)).toBe(true)
    const result = await new AxeBuilder({ page }).include('[data-testid="jd-assistant-dialog"]').analyze()
    await info.attach(label + '-' + width + '-axe', { body: JSON.stringify(result, null, 2), contentType: 'application/json' })
    expect(result.violations).toEqual([])
    const file = info.outputPath(label + '-' + width + '.png')
    await page.screenshot({ path: file, fullPage: true })
    await info.attach(label + '-' + width, { path: file, contentType: 'image/png' })
  }
}

export async function pressTabInsideDialog(page: Page) {
  for (const key of ['Shift+Tab', ...Array.from({ length: 9 }, () => 'Tab')]) {
    await page.keyboard.press(key)
    expect(await page.getByTestId('jd-assistant-dialog').evaluate(element => element.contains(document.activeElement))).toBe(true)
  }
}
