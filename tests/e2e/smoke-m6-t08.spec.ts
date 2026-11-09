/**
 * M6-T08 browser acceptance. Run with --workers=1.
 * Uses synthetic records and loginAs's real ADMIN 2FA enrollment/verification.
 * Does not change global settings or send reports/applications to real users.
 * Service tests own cache invalidation and published-only reader semantics.
 */
import { randomUUID } from 'node:crypto'
import type { JobReport, Referral } from '@prisma/client'
import { test, expect, type BrowserContext, type Page, type TestInfo } from '@playwright/test'
import { e2eDb as db } from './helpers/db'
import { loginAs, type LoginOpts } from './helpers/session'
import { expectPageHealthy } from './helpers/smoke'
import { checkA11y } from './helpers/a11y'
import { formatKLDateTime } from '../../src/lib/format-date'

const COPY = {
  zh: {
    growth: '增长与邀请', reports: '举报队列', synonyms: '搜索同义词', articles: '反诈内容',
    signup: '学生注册进度', void: '作废邀请', reason: '作废原因', confirmVoid: '确认作废',
    cancel: '取消', voidStatus: '已作废', quota: '已用', locked: '查看额度已用完',
    resolve: '处理举报', dismiss: '驳回举报', confirmResolve: '确认处理', confirmDismiss: '确认驳回',
    status: '举报状态', filter: '应用筛选', resolved: '已处理', dismissed: '已驳回',
    newSynonym: '新增同义词组', terms: '同义词（每行一个）', active: '启用',
    saveSynonym: '保存同义词组', edit: '编辑',
    synonymSaved: '已保存，搜索结果最迟约 1 分钟更新。',
    newArticle: '新增文章', title: '标题', category: '类别', body: '正文（Markdown）',
    video: '视频链接（可选）', order: '排序', published: '已发布', draft: '草稿',
    saveArticle: '保存文章', preview: '内容预览', articleSaved: '文章已保存',
    queryError: '筛选条件无效，请重置筛选后重试。', reset: '重置筛选',
    pageError: '分页参数无效，请返回第一页后重试。', firstPage: '返回第一页',
    reasonError: '请填写有效的作废原因。',
    referralSaved: '邀请已作废', reportSaved: '举报处理结果已保存',
    synonymError: '请填写 2–50 个有效且不同的词语，每项不超过 100 字。',
    articleError: '请检查标题、正文、视频链接和排序是否有效。',
    viewVideo: '在新标签页观看视频',
  },
  en: {
    growth: 'Growth and referrals', reports: 'Report queue', synonyms: 'Search synonyms', articles: 'Safety content',
    signup: 'Student registration progress', void: 'Void referral', reason: 'Reason for voiding', confirmVoid: 'Confirm void',
    cancel: 'Cancel', voidStatus: 'Voided', quota: 'Used', locked: 'Job view quota exhausted',
    resolve: 'Resolve report', dismiss: 'Dismiss report', confirmResolve: 'Confirm resolution', confirmDismiss: 'Confirm dismissal',
    status: 'Report status', filter: 'Apply filters', resolved: 'Resolved', dismissed: 'Dismissed',
    newSynonym: 'New synonym group', terms: 'Synonyms (one per line)', active: 'Active',
    saveSynonym: 'Save synonym group', edit: 'Edit',
    synonymSaved: 'Saved. Search results update within about 1 minute.',
    newArticle: 'New article', title: 'Title', category: 'Category', body: 'Body (Markdown)',
    video: 'Video link (optional)', order: 'Sort order', published: 'Published', draft: 'Draft',
    saveArticle: 'Save article', preview: 'Content preview', articleSaved: 'Article saved',
    queryError: 'These filters are invalid. Reset the filters and try again.', reset: 'Reset filters',
    pageError: 'The page parameters are invalid. Return to the first page and try again.', firstPage: 'Back to first page',
    reasonError: 'Enter a valid reason for voiding.',
    referralSaved: 'Referral voided', reportSaved: 'Report outcome saved',
    synonymError: 'Enter 2–50 valid, distinct terms of no more than 100 characters each.',
    articleError: 'Check the title, body, video link and sort order.',
    viewVideo: 'Watch video in a new tab',
  },
} as const
type Locale = keyof typeof COPY
const ROUTES = ['growth', 'reports', 'synonyms', 'articles'] as const

// loginAs handles enrollment secrets through native fetch. Keep automatic
// authentication traces/screenshots off; attach only known synthetic UI states.
test.use({ trace: 'off', screenshot: 'off', video: 'off' })

test.describe('M6-T08 growth and risk administration', () => {
  // The one-worker guard keeps DB fixtures sequential without serial mode's
  // skip-after-first-failure behavior, so every module can show its own red.
  test.setTimeout(150_000)
  let prefix = ''
  let userIds: string[] = []
  let companyIds: string[] = []
  let contexts: BrowserContext[] = []

  test.beforeEach(() => {
    prefix = 'm6t08' + randomUUID().replaceAll('-', '').slice(0, 12)
    userIds = []
    companyIds = []
    contexts = []
    expect(test.info().config.workers, 'Run M6-T08 acceptance with --workers=1').toBe(1)
  })

  test.afterEach(async () => {
    await Promise.all(contexts.map((context) => context.close()))
    if (!/^m6t08[a-f0-9]{12}$/.test(prefix)) throw new Error('Refusing cleanup without a per-case marker')
    // Exact per-case marker scopes cleanup even if a create action succeeded
    // immediately before the browser assertion failed. AuditLog stays append-only.
    await db.article.deleteMany({ where: { title: { startsWith: prefix } } })
    await db.searchSynonymGroup.deleteMany({ where: { terms: { has: prefix + 'alpha' } } })
    await db.company.deleteMany({ where: { id: { in: companyIds } } })
    await db.user.deleteMany({ where: { id: { in: userIds } } })
  })

  async function login(page: Page, opts: LoginOpts) {
    const result = await loginAs(page, opts)
    userIds.push(result.userId)
    if (result.companyId) companyIds.push(result.companyId)
    return result
  }

  async function profileFor(userId: string, name: string) {
    return db.studentProfile.upsert({
      where: { userId },
      create: { userId, fullName: name, completeness: 100, onboardingStep: 5 },
      update: { fullName: name, completeness: 100, onboardingStep: 5 },
    })
  }

  async function syntheticStudent(name: string) {
    const user = await db.user.create({
      data: { name, email: randomUUID() + '@example.test', role: 'STUDENT', emailVerified: true },
    })
    userIds.push(user.id)
    return profileFor(user.id, name)
  }

  async function jobs(ownerId: string, count: number) {
    const company = await db.company.create({
      data: { legalName: prefix + ' Company', verificationStatus: 'VERIFIED', isActive: true },
    })
    companyIds.push(company.id)
    const result = []
    for (let index = 0; index < count; index++) {
      result.push(await db.job.create({
        data: {
          companyId: company.id, createdById: ownerId,
          title: prefix + ' Job ' + index, type: 'INTERNSHIP',
          description: prefix + ' private description ' + index,
          status: 'PUBLISHED', publishedAt: new Date(),
        },
      }))
    }
    return result
  }

  async function evidence(page: Page, info: TestInfo, label: string) {
    for (const width of [375, 1280]) {
      await page.setViewportSize({ width, height: 900 })
      await expect(page.locator('html')).toBeVisible()
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2)).toBe(true)
      await checkA11y(page)
      const path = info.outputPath(label + '-' + width + '.png')
      await page.screenshot({ path, fullPage: true })
      await info.attach(label + '-' + width, { path, contentType: 'image/png' })
    }
    await page.setViewportSize({ width: 375, height: 900 })
  }

  async function adminPage(page: Page, locale: Locale, route: typeof ROUTES[number], query = '') {
    await expectPageHealthy(page, '/' + locale + '/admin/' + route + query)
    await expect(page.getByRole('heading', { level: 1, name: COPY[locale][route], exact: true })).toBeVisible()
    const nav = page.getByRole('navigation', { name: 'Admin navigation' })
    for (const item of ROUTES) {
      await expect(nav.getByRole('link', { name: COPY[locale][item], exact: true }))
        .toHaveAttribute('href', '/' + locale + '/admin/' + item)
    }
    await expect(nav.getByRole('link', { name: COPY[locale][route], exact: true }))
      .toHaveAttribute('aria-current', 'page')
  }

  for (const locale of ['zh', 'en'] as const) {
    test(locale + ': void referral immediately changes quota and keeps historical access', async ({ page, browser }, info) => {
      const c = COPY[locale]
      const admin = await login(page, { role: 'ADMIN' })
      await adminPage(page, locale, 'growth', '?status=INVALID')
      await expect(page.getByRole('main').getByRole('alert')).toHaveText(c.queryError)
      await page.getByRole('link', { name: c.reset, exact: true }).click()
      await expect(page).toHaveURL(new RegExp('/' + locale + '/admin/growth$'))
      await expect(page.getByRole('main').getByRole('alert')).toHaveCount(0)
      const studentContext = await browser.newContext({ viewport: { width: 375, height: 900 } })
      contexts.push(studentContext)
      const studentPage = await studentContext.newPage()
      const student = await login(studentPage, { role: 'STUDENT' })
      const referrer = await profileFor(student.userId, prefix + ' Referrer')
      const referrals: Referral[] = []
      for (let index = 0; index < 3; index++) {
        const invitee = await syntheticStudent(prefix + ' Invitee ' + index)
        referrals.push(await db.referral.create({
          data: { referrerId: referrer.id, inviteeId: invitee.id, status: 'QUALIFIED', qualifiedAt: new Date() },
        }))
      }
      const testJobs = await jobs(admin.userId, 21)
      await db.jobView.createMany({
        data: testJobs.slice(0, 20).map((job) => ({ studentId: referrer.id, jobId: job.id })),
      })
      // Existing quota configuration is an acceptance precondition, not changed.
      await expectPageHealthy(studentPage, '/' + locale + '/s/invite')
      await expect(studentPage.getByRole('progressbar', { name: c.quota }))
        .toHaveAttribute('aria-valuemax', '30')
      await expect(studentPage.getByRole('progressbar', { name: c.quota }))
        .toHaveAttribute('aria-valuenow', '20')

      await adminPage(page, locale, 'growth', '?referrerId=' + referrer.id)
      const registered = await db.user.count({ where: { role: 'STUDENT', status: 'ACTIVE', emailVerified: true } })
      const cap = (await db.systemSetting.findUnique({ where: { key: 'signup.studentCap' } }))?.value ?? 3000
      const signup = page.getByRole('progressbar', { name: c.signup })
      await expect(signup).toHaveAttribute('aria-valuenow', String(registered))
      await expect(signup).toHaveAttribute('aria-valuemax', String(cap))
      await evidence(page, info, locale + '-growth')
      const row = page.getByTestId('referral-' + referrals[0].id)
      await expect(row).toContainText(formatKLDateTime(referrals[0].createdAt, locale))
      const trigger = row.getByRole('button', { name: c.void, exact: true })
      await trigger.click()
      const dialog = page.getByRole('dialog', { name: c.void, exact: true })
      await expect(dialog.getByLabel(c.reason, { exact: true })).toBeVisible()
      await evidence(page, info, locale + '-void-dialog')
      await page.keyboard.press('Escape')
      await expect(dialog).not.toBeVisible()
      await expect(trigger).toBeFocused()
      await trigger.click()
      await dialog.getByLabel(c.reason, { exact: true }).fill('   ')
      await dialog.getByRole('button', { name: c.confirmVoid, exact: true }).click()
      await expect(dialog.getByRole('alert')).toHaveText(c.reasonError)
      await expect(dialog.getByLabel(c.reason, { exact: true })).toHaveValue('   ')
      expect(await db.referral.findUnique({ where: { id: referrals[0].id } }))
        .toMatchObject({ status: 'QUALIFIED', voidReason: null })
      expect(await db.auditLog.count({ where: { action: 'referral.void', targetId: referrals[0].id } })).toBe(0)
      const reason = prefix + ' synthetic duplicate'
      await dialog.getByLabel(c.reason, { exact: true }).fill('  ' + reason + '  ')
      await dialog.getByRole('button', { name: c.confirmVoid, exact: true }).click()
      await expect(dialog).not.toBeVisible()
      await expect(row).toContainText(c.voidStatus)
      // The row action is removed after VOID; feedback and focus must survive it.
      const success = page.getByRole('status').filter({ hasText: c.referralSaved })
      await expect(success).toHaveText(c.referralSaved)
      await expect(success).toBeVisible()
      await expect(success).toBeFocused()
      await evidence(page, info, locale + '-referral-voided')
      await expect.poll(() => db.referral.findUnique({ where: { id: referrals[0].id } }))
        .toMatchObject({ status: 'VOID', voidReason: reason })
      const audit = await db.auditLog.findMany({
        where: { action: 'referral.void', targetType: 'Referral', targetId: referrals[0].id },
      })
      expect(audit).toHaveLength(1)
      expect(audit[0].actorId).toBe(admin.userId)
      expect(audit[0].metadata).toEqual({ fromStatus: 'QUALIFIED', toStatus: 'VOID', reasonLength: reason.length })

      // No polling or cache grace: the first request after the success response
      // must already see 3 -> 2 qualified referrals and 30 -> 20 total views.
      await studentPage.goto('/' + locale + '/s/invite')
      await expect(studentPage.getByRole('progressbar', { name: c.quota })).toHaveAttribute('aria-valuemax', '20')
      await expect(studentPage.getByRole('progressbar', { name: c.quota })).toHaveAttribute('aria-valuenow', '20')
      await studentPage.goto('/' + locale + '/jobs/' + testJobs[20].id)
      await expect(studentPage.getByText(c.locked, { exact: true })).toBeVisible()
      await expect(studentPage.getByText(testJobs[20].description, { exact: true })).toHaveCount(0)
      expect(await db.jobView.count({ where: { studentId: referrer.id } })).toBe(20)
      await studentPage.goto('/' + locale + '/jobs/' + testJobs[0].id)
      await expect(studentPage.getByText(testJobs[0].description, { exact: true })).toBeVisible()
      expect(await db.jobViewGrant.count({ where: { studentId: referrer.id } })).toBe(0)
    })

    test(locale + ': resolve and dismiss reports record exact audit without changing jobs', async ({ page }, info) => {
      const c = COPY[locale]
      const admin = await login(page, { role: 'ADMIN' })
      await adminPage(page, locale, 'reports', '?status=OPEN&status=DISMISSED')
      await expect(page.getByRole('main').getByRole('alert')).toHaveText(c.queryError)
      await page.getByRole('link', { name: c.reset, exact: true }).click()
      await expect(page).toHaveURL(new RegExp('/' + locale + '/admin/reports$'))
      await expect(page.getByRole('main').getByRole('alert')).toHaveCount(0)
      const reporter = await syntheticStudent(prefix + ' Reporter')
      const [job] = await jobs(admin.userId, 1)
      const reports: JobReport[] = []
      for (const reason of ['ASKS_PAYMENT', 'OTHER'] as const) {
        reports.push(await db.jobReport.create({
          data: {
            jobId: job.id, reporterId: reporter.userId, reason,
            note: prefix + ' synthetic report note ' + 'long-word-'.repeat(18),
          },
        }))
      }
      await adminPage(page, locale, 'reports', '?jobId=' + job.id)
      await evidence(page, info, locale + '-reports')
      for (const [index, status, triggerName, confirmName, statusName] of [
        [0, 'RESOLVED', c.resolve, c.confirmResolve, c.resolved],
        [1, 'DISMISSED', c.dismiss, c.confirmDismiss, c.dismissed],
      ] as const) {
        const row = page.getByTestId('report-' + reports[index].id)
        await expect(row).toContainText(formatKLDateTime(reports[index].createdAt, locale))
        const trigger = row.getByRole('button', { name: triggerName, exact: true })
        await trigger.click()
        const dialog = page.getByRole('dialog', { name: triggerName, exact: true })
        await expect(dialog).toBeVisible()
        await evidence(page, info, locale + '-' + status.toLowerCase() + '-dialog')
        await page.keyboard.press('Escape')
        await expect(dialog).not.toBeVisible()
        await expect(trigger).toBeFocused()
        await trigger.click()
        await dialog.getByRole('button', { name: confirmName, exact: true }).click()
        await expect(dialog).not.toBeVisible()
        await expect.poll(() => db.jobReport.findUnique({ where: { id: reports[index].id } }))
          .toMatchObject({ status, resolverId: admin.userId, resolvedAt: expect.any(Date) })
        // Resolving removes this row from the OPEN queue, so its trigger cannot
        // own the post-success focus or announcement.
        await expect(row).toHaveCount(0)
        const success = page.getByRole('status').filter({ hasText: c.reportSaved })
        await expect(success).toHaveText(c.reportSaved)
        await expect(success).toBeVisible()
        await expect(success).toBeFocused()
        await evidence(page, info, locale + '-report-' + status.toLowerCase() + '-saved')
        const audit = await db.auditLog.findMany({
          where: { action: 'job.report.resolve', targetType: 'JobReport', targetId: reports[index].id },
        })
        expect(audit).toHaveLength(1)
        expect(audit[0].actorId).toBe(admin.userId)
        expect(audit[0].metadata).toEqual({ jobId: job.id, fromStatus: 'OPEN', toStatus: status })
        await page.getByLabel(c.status, { exact: true }).selectOption(status)
        await page.getByRole('button', { name: c.filter, exact: true }).click()
        await expect(page.getByTestId('report-' + reports[index].id)).toContainText(statusName)
        await expect(page.getByTestId('report-' + reports[index].id).getByRole('button', { name: c.resolve, exact: true })).toHaveCount(0)
        await expect(page.getByTestId('report-' + reports[index].id).getByRole('button', { name: c.dismiss, exact: true })).toHaveCount(0)
        await adminPage(page, locale, 'reports', '?jobId=' + job.id)
      }
      expect(await db.job.findUnique({ where: { id: job.id } })).toMatchObject({ status: 'PUBLISHED' })
      expect(await db.jobView.count({ where: { jobId: job.id } })).toBe(0)
    })

    test(locale + ': synonym create, edit and disable preserve normalized values', async ({ page }, info) => {
      const c = COPY[locale]
      await login(page, { role: 'ADMIN' })
      await adminPage(page, locale, 'synonyms', '?cursor=%20')
      await expect(page.getByRole('main').getByRole('alert')).toHaveText(c.pageError)
      await page.getByRole('link', { name: c.firstPage, exact: true }).click()
      await expect(page).toHaveURL(new RegExp('/' + locale + '/admin/synonyms$'))
      await expect(page.getByRole('main').getByRole('alert')).toHaveCount(0)
      await evidence(page, info, locale + '-synonyms')
      const newSynonym = page.getByRole('button', { name: c.newSynonym, exact: true })
      await newSynonym.click()
      const form = page.getByTestId('synonym-form')
      await expect(form).toBeVisible()
      await page.keyboard.press('Escape')
      await expect(form).not.toBeVisible()
      await expect(newSynonym).toBeFocused()
      await newSynonym.click()
      const alpha = prefix + 'alpha'
      const beta = prefix + 'beta'
      const gamma = prefix + 'gamma'
      await form.getByLabel(c.terms, { exact: true }).fill(alpha)
      await form.getByLabel(c.active, { exact: true }).check()
      await form.getByRole('button', { name: c.saveSynonym, exact: true }).click()
      await expect(form.getByRole('alert')).toHaveText(c.synonymError)
      await expect(form.getByLabel(c.terms, { exact: true })).toHaveValue(alpha)
      await expect(form.getByLabel(c.active, { exact: true })).toBeChecked()
      expect(await db.searchSynonymGroup.count({ where: { terms: { has: alpha } } })).toBe(0)
      await form.getByLabel(c.terms, { exact: true }).fill('  ' + alpha.toUpperCase() + '  \n' + beta + '\n' + alpha)
      await form.getByLabel(c.active, { exact: true }).check()
      await evidence(page, info, locale + '-synonym-form')
      await form.getByRole('button', { name: c.saveSynonym, exact: true }).click()
      await expect(page.getByRole('status').filter({ hasText: c.synonymSaved })).toHaveText(c.synonymSaved)
      await expect(form).not.toBeVisible()
      const saved = await db.searchSynonymGroup.findFirstOrThrow({ where: { terms: { has: alpha } } })
      expect(saved).toMatchObject({ terms: [alpha, beta], active: true })
      const row = page.getByTestId('synonym-' + saved.id)
      await row.getByRole('button', { name: c.edit, exact: true }).click()
      await expect(form.getByLabel(c.terms, { exact: true })).toHaveValue(alpha + '\n' + beta)
      await form.getByLabel(c.terms, { exact: true }).fill(alpha + '\n' + gamma)
      await form.getByRole('button', { name: c.saveSynonym, exact: true }).click()
      await expect.poll(() => db.searchSynonymGroup.findUnique({ where: { id: saved.id } }))
        .toMatchObject({ terms: [alpha, gamma], active: true })
      await expect(form).not.toBeVisible()
      await expect(row).toContainText(gamma)
      await row.getByRole('button', { name: c.edit, exact: true }).click()
      await form.getByLabel(c.active, { exact: true }).uncheck()
      await form.getByRole('button', { name: c.saveSynonym, exact: true }).click()
      await expect.poll(() => db.searchSynonymGroup.findUnique({ where: { id: saved.id } }))
        .toMatchObject({ terms: [alpha, gamma], active: false })
      await expect(row.getByRole('status')).toHaveText(c.synonymSaved)
      await expect(form).not.toBeVisible()
      await page.reload()
      await expect(page.getByTestId('synonym-' + saved.id)).toBeVisible()
    })

    test(locale + ': article draft, edit, publish and withdraw with safe preview', async ({ page }, info) => {
      const c = COPY[locale]
      await login(page, { role: 'ADMIN' })
      await adminPage(page, locale, 'articles', '?category=INVALID')
      await expect(page.getByRole('main').getByRole('alert')).toHaveText(c.queryError)
      await page.getByRole('link', { name: c.reset, exact: true }).click()
      await expect(page).toHaveURL(new RegExp('/' + locale + '/admin/articles$'))
      await expect(page.getByRole('main').getByRole('alert')).toHaveCount(0)
      await evidence(page, info, locale + '-articles')
      const newArticle = page.getByRole('button', { name: c.newArticle, exact: true })
      await newArticle.click()
      const form = page.getByTestId('article-form')
      await expect(form).toBeVisible()
      await page.keyboard.press('Escape')
      await expect(form).not.toBeVisible()
      await expect(newArticle).toBeFocused()
      await newArticle.click()
      const imageRequests: string[] = []
      await page.route('https://example.test/tracking.png', async (route) => {
        imageRequests.push(route.request().url())
        await route.abort()
      })
      const title = prefix + ' 合成指南 / Synthetic guide'
      const body = '## 合成内容 / Synthetic content\n\n**Never pay for a job.**\n\n<script>globalThis.__m6Unsafe = true</script>\n\n[unsafe](javascript:alert(1))\n\n![remote](https://example.test/tracking.png)'
      await form.getByLabel(c.category, { exact: true }).selectOption('GUIDE')
      await form.getByLabel(c.title, { exact: true }).fill(title)
      await form.getByLabel(c.body, { exact: true }).fill(body)
      const invalidVideo = 'https://synthetic:password@example.test/video'
      await form.getByLabel(c.video, { exact: true }).fill(invalidVideo)
      await form.getByLabel(c.order, { exact: true }).fill('17')
      await expect(form.getByLabel(c.published, { exact: true })).not.toBeChecked()
      await form.getByRole('button', { name: c.saveArticle, exact: true }).click()
      await expect(form.getByRole('alert')).toHaveText(c.articleError)
      await expect(form.getByLabel(c.title, { exact: true })).toHaveValue(title)
      await expect(form.getByLabel(c.body, { exact: true })).toHaveValue(body)
      await expect(form.getByLabel(c.video, { exact: true })).toHaveValue(invalidVideo)
      await expect(form.getByLabel(c.order, { exact: true })).toHaveValue('17')
      expect(await db.article.count({ where: { title } })).toBe(0)
      await form.getByLabel(c.video, { exact: true }).fill('https://example.test/synthetic-video')
      const preview = page.getByRole('region', { name: c.preview, exact: true })
      await expect(preview.locator('strong')).toHaveText('Never pay for a job.')
      await expect(preview.locator('script, iframe, img, a[href^="javascript:"]')).toHaveCount(0)
      expect(await page.evaluate(() => '__m6Unsafe' in globalThis)).toBe(false)
      const video = preview.getByRole('link', { name: c.viewVideo, exact: true })
      await expect(video).toHaveAttribute('href', 'https://example.test/synthetic-video')
      await expect(video).toHaveAttribute('target', '_blank')
      await expect(video).toHaveAttribute('rel', /\bnoopener\b/)
      await expect(video).toHaveAttribute('rel', /\bnoreferrer\b/)
      await evidence(page, info, locale + '-article-form')
      expect(imageRequests).toEqual([])
      await form.getByRole('button', { name: c.saveArticle, exact: true }).click()
      await expect(page.getByRole('status').filter({ hasText: c.articleSaved })).toHaveText(c.articleSaved)
      await expect(form).not.toBeVisible()
      const saved = await db.article.findFirstOrThrow({ where: { title } })
      expect(saved).toMatchObject({
        category: 'GUIDE', title, body, videoUrl: 'https://example.test/synthetic-video', sortOrder: 17, published: false,
      })
      const row = page.getByTestId('article-' + saved.id)
      await expect(row).toContainText(c.draft)
      await row.getByRole('button', { name: c.edit, exact: true }).click()
      await expect(form.getByLabel(c.body, { exact: true })).toHaveValue(body)
      const editedTitle = title + ' revised'
      await form.getByLabel(c.title, { exact: true }).fill(editedTitle)
      await form.getByLabel(c.published, { exact: true }).check()
      await form.getByRole('button', { name: c.saveArticle, exact: true }).click()
      await expect.poll(() => db.article.findUnique({ where: { id: saved.id } }))
        .toMatchObject({ title: editedTitle, published: true })
      await expect(form).not.toBeVisible()
      await expect(row).toContainText(c.published)
      await row.getByRole('button', { name: c.edit, exact: true }).click()
      await form.getByLabel(c.published, { exact: true }).uncheck()
      await form.getByRole('button', { name: c.saveArticle, exact: true }).click()
      await expect.poll(() => db.article.findUnique({ where: { id: saved.id } }))
        .toMatchObject({ title: editedTitle, published: false })
      await expect(form).not.toBeVisible()
      await expect(row).toContainText(c.draft)
      expect(await db.article.count({ where: { id: saved.id } })).toBe(1)
    })
  }

  test('all four admin pages deny guests, students, employers and unenrolled admins', async ({ browser }) => {
    for (const role of ['GUEST', 'STUDENT', 'EMPLOYER', 'ADMIN'] as const) {
      const context = await browser.newContext({ viewport: { width: 375, height: 900 } })
      contexts.push(context)
      const page = await context.newPage()
      if (role === 'ADMIN') await login(page, { role, twoFactor: false })
      if (role === 'STUDENT' || role === 'EMPLOYER') await login(page, { role })
      const expectedPath = role === 'ADMIN' ? 'two-factor/setup' : 'login'
      for (const locale of ['zh', 'en'] as const) {
        for (const route of ROUTES) {
          await page.goto('/' + locale + '/admin/' + route)
          await expect(page).toHaveURL(new RegExp('/' + locale + '/' + expectedPath + '(\\?|$)'))
          await expect(page.getByRole('heading', { name: COPY[locale][route], exact: true })).toHaveCount(0)
        }
      }
    }
  })
})
