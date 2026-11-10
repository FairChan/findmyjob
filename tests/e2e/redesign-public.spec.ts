/**
 * Frontend redesign P3: the remaining public pages.
 * The job list gains a real filter form (the URL parameters already existed); the
 * other pages are restyled, so they are checked for health, accessibility and width.
 *
 * Set REDESIGN_SHOT_DIR to also write full-page screenshots there.
 */
import path from 'node:path'
import { test, expect, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { expectPageHealthy } from './helpers/smoke'
import { e2eDb } from './helpers/db'

const shotDir = process.env.REDESIGN_SHOT_DIR

async function shot(page: Page, name: string) {
  if (!shotDir) return
  await page.screenshot({ path: path.join(shotDir, `${name}.png`), fullPage: true })
}

async function expectNoSeriousA11y(page: Page) {
  const { violations } = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze()
  const serious = violations.filter((v) => v.impact === 'critical' || v.impact === 'serious')
  expect(serious.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`)).toEqual([])
}

async function expectNoHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  )
  expect(overflow).toBeLessThanOrEqual(0)
}

/** These jobs are public and show a salary, so they must not outlive the run. */
async function removeFixtureJobs() {
  await e2eDb.job.deleteMany({ where: { title: { startsWith: 'Zebrafinch ' } } })
}

const unique = `${Date.now()}`
let companyId = ''

test.beforeAll(async () => {
  // Also clears rows left behind by an interrupted run.
  await removeFixtureJobs()
  const company = await e2eDb.company.create({
    data: {
      legalName: `Redesign Public Sdn Bhd ${unique}`,
      displayNameZh: `公开页示例公司${unique}`,
      displayNameEn: `Public Sample ${unique}`,
      description: 'A synthetic company used to check the public pages.',
      website: 'https://example.com/about',
      state: 'Selangor',
      city: 'Petaling Jaya',
      verificationStatus: 'VERIFIED',
      isActive: true,
    },
  })
  companyId = company.id
  const owner = await e2eDb.user.create({
    data: {
      name: 'Redesign Public Owner',
      email: `redesign-public-${unique}@example.test`,
      emailVerified: true,
      role: 'EMPLOYER',
      status: 'ACTIVE',
    },
  })
  const base = {
    companyId: company.id,
    createdById: owner.id,
    description: 'Synthetic job for the public list.',
    status: 'PUBLISHED' as const,
    publishedAt: new Date(),
  }
  await e2eDb.job.create({
    data: {
      ...base,
      title: `Zebrafinch Analyst Intern ${unique}`,
      type: 'INTERNSHIP',
      workMode: 'HYBRID',
      state: 'SGR',
      // Not 1,000 or 2,000: pii-leak.spec.ts asserts those never appear on the public list.
      salaryMin: 1650,
      salaryMax: 2150,
      salaryVisible: true,
      acceptsStudentPass: true,
    },
  })
  await e2eDb.job.create({
    data: {
      ...base,
      title: `Zebrafinch Operations Executive ${unique}`,
      type: 'FULL_TIME',
      workMode: 'ONSITE',
      state: 'KUL',
    },
  })
})

test.afterAll(removeFixtureJobs)

test.describe('redesign: job list', () => {
  test('keyword and type filters narrow the list and can be cleared', async ({ page }) => {
    await page.goto('/zh/jobs')
    await expect(page.getByRole('heading', { level: 1, name: '职位列表' })).toBeVisible()
    await expect(page.getByText('找到我的对口工作')).toBeVisible()

    const search = page.getByRole('search', { name: '筛选职位' })
    await search.getByRole('searchbox', { name: '关键词' }).fill(`Zebrafinch ${unique}`)
    await search.getByRole('button', { name: '搜索' }).click()
    await expect(page).toHaveURL(/\/zh\/jobs\?.*q=Zebrafinch/)
    // The keyword survives the round trip even though the unused selects were submitted blank.
    await expect(search.getByRole('searchbox', { name: '关键词' })).toHaveValue(`Zebrafinch ${unique}`)
    // Search is fuzzy, so other jobs may be listed too; both of ours must be.
    const analyst = page.getByRole('heading', { level: 2, name: `Zebrafinch Analyst Intern ${unique}` })
    const operations = page.getByRole('heading', { level: 2, name: `Zebrafinch Operations Executive ${unique}` })
    await expect(analyst).toBeVisible()
    await expect(operations).toBeVisible()

    await search.getByLabel('职位类型').selectOption('INTERNSHIP')
    await search.getByRole('button', { name: '搜索' }).click()
    await expect(page).toHaveURL(/type=INTERNSHIP/)
    await expect(analyst).toBeVisible()
    await expect(operations).toHaveCount(0)

    // The card carries the facts a student scans for.
    const card = page.getByRole('link', { name: new RegExp(`Zebrafinch Analyst Intern ${unique}`) })
    await expect(card).toContainText('实习')
    await expect(card).toContainText('混合办公')
    await expect(card).toContainText('雪兰莪')
    await expect(card).toContainText('接受学生准证')
    await expect(card).toContainText('MYR 1,650 – 2,150')
    // The selected filter is still shown after the search.
    await expect(search.getByLabel('职位类型')).toHaveValue('INTERNSHIP')

    await expectNoSeriousA11y(page)
    await shot(page, 'jobs-zh-1440')

    await search.getByRole('link', { name: '清除筛选' }).click()
    await expect(page).toHaveURL(/\/zh\/jobs$/)
    await expect(search.getByRole('link', { name: '清除筛选' })).toHaveCount(0)
  })

  test('a search with no match explains what to do next', async ({ page }) => {
    await page.goto(`/en/jobs?q=nomatch${unique}xyz`)
    await expect(page.getByText('Try another keyword, or clear the filters.')).toBeVisible()
    await expect(page.getByRole('search', { name: 'Filter jobs' }).getByRole('searchbox')).toHaveValue(
      `nomatch${unique}xyz`,
    )
  })

  test('375px: filters and cards fit', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 })
    await page.goto(`/zh/jobs?q=Zebrafinch%20${unique}`)
    await expect(page.getByRole('heading', { level: 2, name: `Zebrafinch Analyst Intern ${unique}` })).toBeVisible()
    await expectNoHorizontalScroll(page)
    await shot(page, 'jobs-zh-375')
  })
})

test.describe('redesign: other public pages', () => {
  test('company list and company page', async ({ page }) => {
    await expectPageHealthy(page, '/zh/companies')
    await expect(page.getByRole('link', { name: '全部', exact: true })).toHaveAttribute('aria-current', 'true')
    await expectNoSeriousA11y(page)
    await shot(page, 'companies-zh-1440')

    await page.getByRole('link', { name: '校友企业', exact: true }).click()
    await expect(page).toHaveURL(/tag=ALUMNI/)
    await expect(page.getByRole('link', { name: '校友企业', exact: true })).toHaveAttribute('aria-current', 'true')

    // Loading more keeps the visitor on a real page (the link used to double the locale).
    const more = page.getByRole('link', { name: '加载更多' })
    if (await more.count()) {
      await expect(more).toHaveAttribute('href', /^\/zh\/companies\?/)
    }

    await expectPageHealthy(page, `/zh/companies/${companyId}`)
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(`公开页示例公司${unique}`)
    await expect(page.getByText('Petaling Jaya, Selangor')).toBeVisible()
    await expect(page.locator('a[href="https://example.com/about"]')).toHaveText(/example\.com/)
    await expectNoSeriousA11y(page)
    await shot(page, 'company-zh-1440')
  })

  for (const [name, url] of [
    ['for-employers', '/zh/for-employers'],
    ['partners', '/zh/partners'],
    ['safety', '/zh/safety'],
    ['pricing', '/zh/pricing'],
    ['privacy', '/zh/legal/privacy'],
  ] as const) {
    test(`${name}: healthy, accessible, fits 375px`, async ({ page }) => {
      await expectPageHealthy(page, url)
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
      await expectNoSeriousA11y(page)
      await shot(page, `${name}-zh-1440`)
      await page.setViewportSize({ width: 375, height: 812 })
      await page.goto(url)
      await expectNoHorizontalScroll(page)
    })
  }

  test('an unmatched address shows the designed 404, not the framework default', async ({ page }) => {
    const res = await page.goto('/zh/zh/companies')
    expect(res?.status()).toBe(404)
    await expect(page.getByRole('heading', { level: 1, name: '没有找到这个页面' })).toBeVisible()
  })

  test('job list pagination link stays inside the locale', async ({ page }) => {
    await page.goto('/zh/jobs')
    const more = page.getByRole('link', { name: '加载更多' })
    if (await more.count()) {
      await expect(more).toHaveAttribute('href', /^\/zh\/jobs\?/)
      await more.click()
      await expect(page.getByRole('heading', { level: 1, name: '职位列表' })).toBeVisible()
    }
  })

  test('for-employers leads with one primary action', async ({ page }) => {
    await page.goto('/en/for-employers')
    const main = page.locator('main')
    await expect(main.locator('a[href="/en/register/employer"]')).toHaveCount(2)
    await expect(main.locator('a[href="/en/pricing"]')).toBeVisible()
    await expect(main.getByRole('list').first().getByRole('listitem')).toHaveCount(3)
  })
})
