/**
 * M7-T09 browser acceptance. Apply after the M6 commit; run with --workers=1.
 * UI contract: /[locale]/safety accepts category/cursor, uses labeled native
 * category select and [data-testid="safety-article-{id}"] accordion rows.
 * ReportJobDialog({jobId}) appears on full and locked job pages; native reason
 * select/note textarea, role=alert for errors, outside role=status for success.
 * Real M6 services/renderer and real loginAs ADMIN 2FA; no action/network mocks.
 * Independent cases (no serial skip cascade). Synthetic prefix cleanup only;
 * append-only audit rows remain. Automatic trace/video/screenshots are off.
 * CSP assertions compare unchanged directives with the same app's home page;
 * existing production security specs still own strict production CSP coverage.
 */
import { randomUUID } from 'node:crypto'
import { test, expect, type BrowserContext, type Page, type TestInfo } from '@playwright/test'
import { e2eDb as db } from './helpers/db'
import { loginAs, type LoginOpts } from './helpers/session'
import { checkA11y } from './helpers/a11y'

test.use({ storageState: { cookies: [], origins: [] }, actionTimeout: 15_000, trace: 'off', screenshot: 'off', video: 'off' })

const COPY = {
  zh: {
    reset: '查看全部', empty: '此类别暂时没有已发布内容。',
    errorQuery: '筛选或分页条件无效，请返回全部内容重试。',
    safety: '求职防骗', category: '内容类别', filter: '查看内容', next: '下一页',
    video: '在新标签页观看视频',
    report: '举报职位', reason: '举报原因', note: '补充说明（可选）', submit: '提交举报',
    success: '举报已收到，感谢你帮助维护求职安全。',
    locked: '查看额度已用完', queue: '举报队列', resolve: '处理举报', confirm: '确认处理',
  },
  en: {
    reset: 'View all', empty: 'There is no published content in this category yet.',
    errorQuery: 'The filter or page parameters are invalid. Return to all content and try again.',
    safety: 'Job safety', category: 'Content category', filter: 'View content', next: 'Next page',
    video: 'Watch video in a new tab',
    report: 'Report job', reason: 'Report reason', note: 'Additional details (optional)', submit: 'Submit report',
    success: 'Report received. Thank you for helping keep job searches safe.',
    locked: 'Job view quota exhausted', queue: 'Report queue', resolve: 'Resolve report', confirm: 'Confirm resolution',
  },
} as const
type Locale = keyof typeof COPY

test.describe('M7-T09 safety content and reporting', () => {
  test.setTimeout(180_000)
  let prefix = ''
  let userIds: string[] = []
  let companyIds: string[] = []
  let contexts: BrowserContext[] = []

  test.beforeEach(() => {
    prefix = 'm7t09' + randomUUID().replaceAll('-', '').slice(0, 12)
    userIds = []
    companyIds = []
    contexts = []
    expect(test.info().config.workers, 'Run M7-T09 with --workers=1').toBe(1)
  })

  test.afterEach(async () => {
    await Promise.all(contexts.map((context) => context.close()))
    if (!/^m7t09[a-f0-9]{12}$/.test(prefix)) throw new Error('Refusing cleanup without a per-case prefix')
    // Report notifications may target other synthetic ACTIVE ADMIN fixtures.
    // Delete only notifications tied to this case's exact job/report IDs.
    const reports = await db.jobReport.findMany({
      where: { job: { companyId: { in: companyIds } } }, select: { id: true },
    })
    if (reports.length) {
      await db.notification.deleteMany({
        where: {
          type: 'report.new',
          OR: reports.map(({ id }) => ({ payload: { path: ['reportId'], equals: id } })),
        },
      })
    }
    await db.article.deleteMany({ where: { id: { startsWith: prefix + '-' } } })
    await db.company.deleteMany({ where: { id: { in: companyIds } } })
    await db.user.deleteMany({ where: { id: { in: userIds } } })
  })

  async function login(page: Page, options: LoginOpts) {
    const user = await loginAs(page, options)
    userIds.push(user.userId)
    if (user.companyId) companyIds.push(user.companyId)
    return user
  }

  async function studentProfile(userId: string) {
    return db.studentProfile.upsert({
      where: { userId },
      create: { userId, fullName: prefix + ' Student', completeness: 100, onboardingStep: 5 },
      update: { fullName: prefix + ' Student', completeness: 100, onboardingStep: 5 },
    })
  }

  async function jobFixture(ownerId: string) {
    const company = await db.company.create({
      data: { legalName: prefix + ' Company', verificationStatus: 'VERIFIED', isActive: true },
    })
    companyIds.push(company.id)
    return db.job.create({
      data: {
        companyId: company.id, createdById: ownerId, title: prefix + ' Public job',
        description: prefix + ' PRIVATE_DESCRIPTION',
        requirements: prefix + ' PRIVATE_REQUIREMENTS',
        benefits: prefix + ' PRIVATE_BENEFITS',
        status: 'PUBLISHED', publishedAt: new Date(), type: 'INTERNSHIP', workMode: 'HYBRID',
      },
    })
  }

  async function evidence(page: Page, info: TestInfo, label: string) {
    for (const width of [375, 1280]) {
      await page.setViewportSize({ width, height: 900 })
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2)).toBe(true)
      await checkA11y(page)
      const path = info.outputPath(label + '-' + width + '.png')
      await page.screenshot({ path, fullPage: true })
      await info.attach(label + '-' + width, { path, contentType: 'image/png' })
    }
    await page.setViewportSize({ width: 375, height: 900 })
  }

  function policyDirective(policy: string, name: string) {
    return policy.split(';').map((part) => part.trim()).find((part) => part.startsWith(name + ' '))
  }

  async function unchangedCsp(page: Page, path: string, locale: Locale) {
    const baseline = await page.request.get('/' + locale)
    const response = await page.request.get(path)
    expect(response.status()).toBe(200)
    const policy = response.headers()['content-security-policy'] ?? ''
    const original = baseline.headers()['content-security-policy'] ?? ''
    expect(policy).not.toBe('')
    expect(response.headers()['content-security-policy-report-only']).toBeUndefined()
    expect(policyDirective(policy, 'frame-src')).toBe('frame-src https://challenges.cloudflare.com')
    expect(policyDirective(policy, 'object-src')).toBe("object-src 'none'")
    expect(policyDirective(policy, 'connect-src')).toBe(policyDirective(original, 'connect-src'))
    expect(policy).not.toContain('video.example.test')
    expect(policy).not.toContain('tracking.example.test')
  }

  async function readPagePayloads(page: Page) {
    // Read both wire formats with the browser context's real authentication.
    // API responses remain readable across navigation; intercepting navigation
    // changes Chromium's local-network checks and can block dev hydration.
    const html = await page.request.get(page.url())
    const rsc = await page.request.get(page.url(), { headers: { RSC: '1' } })
    expect(html.status()).toBe(200)
    expect(rsc.status()).toBe(200)
    expect(html.headers()['content-type']).toContain('text/html')
    expect(rsc.headers()['content-type']).toContain('text/x-component')
    return [await html.text(), await rsc.text()]
  }

  for (const locale of ['zh', 'en'] as const) {
    const c = COPY[locale]

    test(locale + ': anonymous safety page filters, paginates and excludes drafts from HTML/RSC', async ({ page }, info) => {
      const draftMarker = prefix + '_DRAFT_SECRET'
      const guideIds = Array.from({ length: 26 }, (_, index) => prefix + '-guide-' + String(index).padStart(2, '0'))
      await db.article.createMany({
        data: guideIds.map((id, index) => ({
          id, category: 'GUIDE', title: prefix + ' Guide ' + index,
          body: '**' + prefix + ' safe guidance ' + index + '**',
          // A lower-bound cursor later selects this test's finite final sort range.
          sortOrder: 10_000, published: true,
        })),
      })
      await db.article.createMany({
        data: [
          { id: prefix + '-guide-00-draft', category: 'GUIDE', title: draftMarker, body: draftMarker, sortOrder: 10_000, published: false },
          { id: prefix + '-fraud', category: 'FRAUD_CASE', title: prefix + ' Scam case', body: 'Synthetic scam case', sortOrder: 0, published: true },
          { id: prefix + '-contact', category: 'CONTACT', title: prefix + ' Contacts', body: 'Verification pending. No invented contact numbers.', sortOrder: 0, published: true },
        ],
      })
      await db.article.update({
        where: { id: guideIds[0] },
        data: {
          body: '**' + prefix + ' safe guidance**\n\n<script>globalThis.__m7Unsafe = true</script>\n\n[unsafe](javascript:alert(1))\n\n![remote](https://tracking.example.test/' + prefix + '.png)',
          videoUrl: 'https://video.example.test/' + prefix,
        },
      })
      const imageRequests: string[] = []
      await page.route('https://tracking.example.test/**', async (route) => {
        imageRequests.push(route.request().url())
        await route.abort()
      })
      const response = await page.goto('/' + locale + '/safety')
      expect(response?.status()).toBe(200)
      const payloads = [await response!.text()]
      await expect(page.getByRole('heading', { level: 1, name: c.safety, exact: true })).toBeVisible()
      // Public header/footer navigation exposes the safety destination.
      expect(await page.getByRole('link', { name: c.safety, exact: true }).count()).toBeGreaterThan(0)
      const main = page.getByRole('main')
      for (const query of ['category=GUIDE&category=CONTACT', 'cursor=malformed-cursor']) {
        await page.goto('/' + locale + '/safety?' + query)
        await expect(main.getByRole('alert')).toHaveText(c.errorQuery)
        await expect(main.getByRole('alert')).toBeVisible()
        await main.getByRole('link', { name: c.reset, exact: true }).click()
        await expect(page).toHaveURL(new RegExp('/' + locale + '/safety$'))
        await expect(main.getByRole('alert')).toHaveCount(0)
      }
      const emptyCursor = Buffer.from(JSON.stringify({
        sortOrder: 10_000, id: 'z'.repeat(128),
      })).toString('base64url')
      await page.goto('/' + locale + '/safety?category=GUIDE&cursor=' + emptyCursor)
      await expect(main.getByText(c.empty, { exact: true })).toBeVisible()
      await expect(main.locator('[data-testid^="safety-article-"]')).toHaveCount(0)
      await expect(main.getByRole('alert')).toHaveCount(0)
      await expect(main.getByRole('link', { name: c.next, exact: true })).toHaveCount(0)
      await page.goto('/' + locale + '/safety')
      await page.getByLabel(c.category, { exact: true }).selectOption('FRAUD_CASE')
      await page.getByRole('button', { name: c.filter, exact: true }).click()
      await expect(page).toHaveURL(new RegExp('category=FRAUD_CASE'))
      await expect(page.getByTestId('safety-article-' + prefix + '-fraud')).toBeVisible()
      await expect(page.getByTestId('safety-article-' + prefix + '-contact')).toHaveCount(0)

      await page.getByLabel(c.category, { exact: true }).selectOption('GUIDE')
      await page.getByRole('button', { name: c.filter, exact: true }).click()
      await expect(page).toHaveURL(new RegExp('category=GUIDE'))
      await expect(page.getByTestId('safety-article-' + prefix + '-fraud')).toHaveCount(0)
      // Uses the documented public cursor shape without deleting or hiding existing articles.
      const cursor = Buffer.from(JSON.stringify({ sortOrder: 10_000, id: prefix + '-guide-' })).toString('base64url')
      await page.goto('/' + locale + '/safety?category=GUIDE&cursor=' + cursor)
      const seen: string[] = []
      for (let pageNumber = 0; pageNumber < 10; pageNumber++) {
        await expect(page.getByRole('heading', { level: 1, name: c.safety, exact: true })).toBeVisible()
        payloads.push(...await readPagePayloads(page))
        const visibleIds = await page.locator('[data-testid^="safety-article-"]').evaluateAll((elements) =>
          elements.map((element) => element.getAttribute('data-testid')!.slice('safety-article-'.length)),
        )
        seen.push(...visibleIds.filter((id) => guideIds.includes(id)))
        expect(new Set(seen).size).toBe(seen.length)
        await expect(page.getByText(draftMarker, { exact: true })).toHaveCount(0)
        if (pageNumber === 0) {
          const article = page.getByTestId('safety-article-' + guideIds[0])
          // Articles sit in an accordion; open this one if another row is expanded.
          const toggle = article.getByRole('button').first()
          if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click()
          await expect(toggle).toHaveAttribute('aria-expanded', 'true')
          await expect(article.locator('strong')).toContainText(prefix + ' safe guidance')
          await expect(article.locator('script, iframe, img, a[href^="javascript:"]')).toHaveCount(0)
          expect(await page.evaluate(() => '__m7Unsafe' in globalThis)).toBe(false)
          const video = article.getByRole('link', { name: c.video, exact: true })
          await expect(video).toHaveAttribute('target', '_blank')
          await expect(video).toHaveAttribute('rel', /\bnoopener\b/)
          await expect(video).toHaveAttribute('rel', /\bnoreferrer\b/)
          await evidence(page, info, locale + '-safety-guide')
        }
        if (seen.length === guideIds.length) break
        const next = page.getByRole('link', { name: c.next, exact: true })
        await expect(next).toBeVisible()
        const previousUrl = page.url()
        await next.click()
        await expect(page).not.toHaveURL(previousUrl)
        if (visibleIds.length) await expect(page.getByTestId('safety-article-' + visibleIds[0])).toHaveCount(0)
        expect(new URL(page.url()).searchParams.get('category')).toBe('GUIDE')
      }
      expect(seen.sort()).toEqual([...guideIds].sort())
      expect(imageRequests).toEqual([])
      const markup = payloads
      expect(markup.length).toBeGreaterThan(0)
      for (const html of markup) expect(html).not.toContain(draftMarker)
      expect(await page.content()).not.toContain(draftMarker)
      await unchangedCsp(page, '/' + locale + '/safety?category=GUIDE', locale)
    })

    test(locale + ': real user report reaches notification, admin queue and resolution audit', async ({ page, browser, baseURL }, info) => {
      const admin = await login(page, { role: 'ADMIN' })
      const studentContext = await browser.newContext({ baseURL, viewport: { width: 375, height: 900 } })
      contexts.push(studentContext)
      const studentPage = await studentContext.newPage()
      const student = await login(studentPage, { role: 'STUDENT' })
      const profile = await studentProfile(student.userId)
      const job = await jobFixture(admin.userId)
      await studentPage.goto('/' + locale + '/jobs/' + job.id)
      await expect(studentPage.getByText(job.description, { exact: true })).toBeVisible()
      const beforeViews = await db.jobView.count({ where: { studentId: profile.id } })
      await evidence(studentPage, info, locale + '-job-detail')
      const trigger = studentPage.getByRole('button', { name: c.report, exact: true })
      await expect(trigger).toBeVisible()
      await trigger.click()
      const dialog = studentPage.getByRole('dialog', { name: c.report, exact: true })
      await expect(dialog.getByLabel(c.reason, { exact: true })).toBeVisible()
      await evidence(studentPage, info, locale + '-report-dialog')
      const controls = dialog.locator('select,textarea,button:not([disabled])')
      await controls.last().focus()
      await studentPage.keyboard.press('Tab')
      await expect(controls.first()).toBeFocused()
      await studentPage.keyboard.press('Shift+Tab')
      await expect(controls.last()).toBeFocused()
      await studentPage.keyboard.press('Escape')
      await expect(dialog).not.toBeVisible()
      await expect(trigger).toBeFocused()
      await studentPage.keyboard.press('Enter')
      await expect(dialog).toBeVisible()
      const note = prefix + ' synthetic report details'
      await dialog.getByLabel(c.reason, { exact: true }).selectOption('MISMATCH')
      await dialog.getByLabel(c.note, { exact: true }).fill(note)
      await dialog.getByRole('button', { name: c.submit, exact: true }).click()
      await expect(dialog).not.toBeVisible()
      await expect(studentPage.getByRole('status').filter({ hasText: c.success })).toHaveText(c.success)
      await expect(trigger).toBeFocused()
      const reports = await db.jobReport.findMany({ where: { jobId: job.id, reporterId: student.userId } })
      expect(reports).toHaveLength(1)
      const report = reports[0]
      expect(report).toMatchObject({ reason: 'MISMATCH', note, status: 'OPEN', resolverId: null })
      expect(await db.notification.findMany({
        where: { userId: admin.userId, type: 'report.new', payload: { path: ['reportId'], equals: report.id } },
      })).toEqual([expect.objectContaining({ payload: { reportId: report.id } })])
      expect(await db.jobView.count({ where: { studentId: profile.id } })).toBe(beforeViews)
      expect(await db.application.count({ where: { studentId: profile.id } })).toBe(0)

      await page.goto('/' + locale + '/admin/reports?jobId=' + job.id)
      await expect(page.getByRole('heading', { level: 1, name: c.queue, exact: true })).toBeVisible()
      const row = page.getByTestId('report-' + report.id)
      await expect(row).toContainText(note)
      await row.getByRole('button', { name: c.resolve, exact: true }).click()
      const resolveDialog = page.getByRole('dialog', { name: c.resolve, exact: true })
      await resolveDialog.getByRole('button', { name: c.confirm, exact: true }).click()
      await expect(resolveDialog).not.toBeVisible()
      await expect.poll(() => db.jobReport.findUnique({ where: { id: report.id } }))
        .toMatchObject({ status: 'RESOLVED', resolverId: admin.userId, resolvedAt: expect.any(Date) })
      expect(await db.auditLog.findMany({ where: { action: 'job.report.resolve', targetId: report.id } }))
        .toEqual([expect.objectContaining({
          actorId: admin.userId, targetType: 'JobReport',
          metadata: { jobId: job.id, fromStatus: 'OPEN', toStatus: 'RESOLVED' },
        })])
      expect(await db.job.findUnique({ where: { id: job.id } })).toMatchObject({ status: 'PUBLISHED' })
    })

    test(locale + ': quota-locked card can report without revealing or opening job details', async ({ page }, info) => {
      const student = await login(page, { role: 'STUDENT' })
      const profile = await studentProfile(student.userId)
      const enabled = (await db.systemSetting.findUnique({ where: { key: 'studentQuota.enabled' } }))?.value ?? true
      const base = (await db.systemSetting.findUnique({ where: { key: 'studentQuota.baseJobViews' } }))?.value ?? 20
      expect(enabled, 'Acceptance requires the existing quota feature to be enabled').toBe(true)
      if (typeof base !== 'number' || !Number.isSafeInteger(base) || base < 0 || base > 1000) {
        throw new Error('Expected a bounded synthetic test quota configuration')
      }
      const job = await jobFixture(student.userId)
      const historyIds = Array.from({ length: base }, () => randomUUID())
      if (historyIds.length) {
        await db.job.createMany({
          data: historyIds.map((id) => ({
            id, companyId: job.companyId, createdById: student.userId,
            title: prefix + ' Previously viewed', description: 'Synthetic historical details',
            type: 'INTERNSHIP', status: 'PUBLISHED',
          })),
        })
        await db.jobView.createMany({ data: historyIds.map((jobId) => ({ studentId: profile.id, jobId })) })
      }
      const response = await page.goto('/' + locale + '/jobs/' + job.id)
      expect(response?.status()).toBe(200)
      const payloads = [await response!.text(), ...await readPagePayloads(page)]
      await expect(page.getByText(c.locked, { exact: true })).toBeVisible()
      await expect(page.getByRole('heading', { level: 1, name: job.title, exact: true })).toBeVisible()
      await evidence(page, info, locale + '-locked-job')
      const trigger = page.getByRole('button', { name: c.report, exact: true })
      await expect(trigger).toBeVisible()
      await trigger.click()
      const dialog = page.getByRole('dialog', { name: c.report, exact: true })
      await dialog.getByLabel(c.reason, { exact: true }).selectOption('ASKS_PAYMENT')
      await evidence(page, info, locale + '-locked-report-dialog')
      await dialog.getByRole('button', { name: c.submit, exact: true }).click()
      await expect(dialog).not.toBeVisible()
      await expect(page.getByRole('status').filter({ hasText: c.success })).toHaveText(c.success)
      expect(await db.jobReport.findMany({ where: { jobId: job.id, reporterId: student.userId } }))
        .toEqual([expect.objectContaining({ reason: 'ASKS_PAYMENT', note: null, status: 'OPEN' })])
      expect(await db.jobView.count({ where: { studentId: profile.id } })).toBe(base)
      expect(await db.jobView.count({ where: { studentId: profile.id, jobId: job.id } })).toBe(0)
      expect(await db.application.count({ where: { studentId: profile.id } })).toBe(0)
      expect(payloads.length).toBeGreaterThan(0)
      const markup = [...payloads, await page.content()]
      for (const privateText of [job.description, job.requirements!, job.benefits!]) {
        for (const html of markup) expect(html).not.toContain(privateText)
      }
      await unchangedCsp(page, '/' + locale + '/jobs/' + job.id, locale)
    })
  }
})
