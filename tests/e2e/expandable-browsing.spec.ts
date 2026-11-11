import { randomBytes } from 'node:crypto'
import path from 'node:path'
import { test, expect, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { e2eDb } from './helpers/db'
import { loginAs } from './helpers/session'

const unique = randomBytes(6).toString('hex')
const keyword = `Expand${unique}`
const companyIds = [0, 1].map(i => `c000${i}${randomBytes(10).toString('hex')}`)
const companyNames = [`展开科技 ${unique}`, `另一家公司 ${unique}`]
let jobId = ''
let hiddenJobId = ''

async function screenshot(page: Page, name: string) {
  if (process.env.REDESIGN_SHOT_DIR) {
    await page.screenshot({ path: path.join(process.env.REDESIGN_SHOT_DIR, `${name}.png`), fullPage: true })
  }
}

async function student(page: Page) {
  const { userId } = await loginAs(page, { role: 'STUDENT' })
  return e2eDb.studentProfile.create({ data: { userId, fullName: 'Expandable Student', completeness: 80 } })
}

async function noOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0)
}

test.beforeAll(async () => {
  const owner = await e2eDb.user.create({ data: {
    name: 'Expandable Fixture Owner', email: `expandable-${unique}@example.test`,
    role: 'EMPLOYER', status: 'ACTIVE', emailVerified: true,
  } })
  for (const [i, id] of companyIds.entries()) {
    await e2eDb.company.create({ data: {
      id, legalName: companyNames[i], displayNameZh: companyNames[i], displayNameEn: `Expandable Company ${i} ${unique}`,
      description: `Company profile ${i} ${unique}`, verificationStatus: 'VERIFIED', isActive: true,
      tags: ['CN_OVERSEAS'], state: 'SGR', city: 'Petaling Jaya', website: 'https://example.com',
    } })
  }
  const base = { createdById: owner.id, companyId: companyIds[0], type: 'INTERNSHIP' as const,
    workMode: 'HYBRID' as const, state: 'SGR', publishedAt: new Date(), status: 'PUBLISHED' as const,
    description: `Protected job description ${unique}`, requirements: 'Bilingual communication',
  }
  const job = await e2eDb.job.create({ data: { ...base, title: `${keyword} Product Intern`, salaryVisible: true, salaryMin: 1750, salaryMax: 2350 } })
  jobId = job.id
  const hidden = await e2eDb.job.create({ data: { ...base, title: `${keyword} Hidden Salary`, salaryVisible: false, salaryMin: 987653, salaryMax: 987654 } })
  hiddenJobId = hidden.id
  await e2eDb.job.create({ data: { ...base, title: `${keyword} Expired`, deadline: new Date(Date.now() - 60_000) } })
  await e2eDb.job.create({ data: { ...base, title: `${keyword} Draft`, status: 'DRAFT' } })
})

test.afterAll(async () => {
  await e2eDb.jobView.deleteMany({ where: { job: { companyId: { in: companyIds } } } })
  await e2eDb.application.deleteMany({ where: { job: { companyId: { in: companyIds } } } })
  await e2eDb.job.deleteMany({ where: { companyId: { in: companyIds } } })
  await e2eDb.company.deleteMany({ where: { id: { in: companyIds } } })
})

test('job card opens accessible details and restores filtered list without spending quota on list render', async ({ page }) => {
  const profile = await student(page)
  const listUrl = `/zh/s/jobs?q=${keyword}&type=INTERNSHIP`
  await page.goto(listUrl)
  const card = page.locator(`main a[href="/zh/s/jobs/${jobId}"]`)
  await expect(card).toBeVisible()
  await expect(page.locator('main')).not.toContainText('987653')
  await expect(page.locator('main')).not.toContainText(`Protected job description ${unique}`)
  expect(await e2eDb.jobView.count({ where: { studentId: profile.id } })).toBe(0)
  await screenshot(page, 'jobs-grid-desktop')
  await card.click()
  const details = page.getByRole('dialog', { name: '职位详情', exact: true })
  await expect(details).toBeVisible()
  await expect(page).toHaveURL(`/zh/s/jobs/${jobId}`)
  await expect(details.getByRole('heading', { name: `${keyword} Product Intern`, exact: true })).toBeVisible()
  await expect(details).toContainText(`Protected job description ${unique}`)
  const a11y = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze()
  expect(a11y.violations.filter(v => ['critical', 'serious'].includes(v.impact ?? '')).map(v => v.id)).toEqual([])
  await screenshot(page, 'job-modal-desktop')

  await details.getByRole('button', { name: '立即投递', exact: true }).click()
  const apply = page.getByRole('dialog', { name: '投递职位', exact: true })
  await expect(apply).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(apply).toBeHidden()
  await expect(details).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(details).toBeHidden()
  await expect(page).toHaveURL(listUrl)
  await expect(card).toBeFocused()
  await expect(page.locator('#jobs-q')).toHaveValue(keyword)
  expect(await page.evaluate(() => getComputedStyle(document.body).overflow)).not.toBe('hidden')
  expect(await e2eDb.jobView.count({ where: { studentId: profile.id } })).toBe(1)

  await page.goForward()
  await expect(details).toBeVisible()
  await details.getByRole('button', { name: '关闭职位详情', exact: true }).click()
  await expect(details).toBeHidden()
  await expect(page).toHaveURL(listUrl)
  await card.click()
  await expect(details).toBeVisible()
  await page.mouse.click(4, 4)
  await expect(details).toBeHidden()
  await expect(card).toBeFocused()
  await card.click()
  await expect(details).toBeVisible()
  expect(await e2eDb.jobView.count({ where: { studentId: profile.id } })).toBe(1)
  await page.reload()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(`${keyword} Product Intern`)
  await expect(page.getByRole('banner')).toBeVisible()
})

test('company selection pins jobs inline and its job modal returns to the selected company', async ({ page }) => {
  const profile = await student(page)
  await page.goto('/zh/s/companies?tag=CN_OVERSEAS')
  await page.getByTestId(`company-card-${companyIds[0]}`).click()
  await expect(page).toHaveURL(new RegExp(`company=${companyIds[0]}`))
  const panel = page.getByTestId('company-jobs-panel')
  await expect(panel.getByRole('heading', { name: companyNames[0], exact: true })).toBeVisible()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(panel).toContainText(`${keyword} Product Intern`)
  await expect(panel).not.toContainText(`${keyword} Expired`)
  await expect(panel).not.toContainText(`${keyword} Draft`)
  await expect(panel).not.toContainText('987653')
  await expect(panel).not.toContainText(`Protected job description ${unique}`)
  expect(await e2eDb.jobView.count({ where: { studentId: profile.id } })).toBe(0)
  await screenshot(page, 'companies-panel-desktop')
  const selectedUrl = page.url()
  await panel.locator(`a[href="/zh/s/jobs/${jobId}"]`).click()
  const details = page.getByRole('dialog', { name: '职位详情', exact: true })
  await expect(details).toBeVisible()
  await expect(details.getByRole('heading', { name: `${keyword} Product Intern`, exact: true })).toBeVisible()
  await details.getByRole('button', { name: '关闭职位详情', exact: true }).click()
  await expect(page).toHaveURL(selectedUrl)
  await expect(panel).toContainText(companyNames[0])
  await page.getByTestId(`company-card-${companyIds[1]}`).click()
  await expect(panel.getByRole('heading', { name: companyNames[1], exact: true })).toBeVisible()
  await expect(panel).toContainText('暂无在招职位')
  await expect(page.getByRole('dialog')).toHaveCount(0)
})

test('375px reduced motion: company panel is inline, job modal fits and English direct detail works', async ({ page }) => {
  await student(page)
  await page.setViewportSize({ width: 375, height: 812 })
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('/zh/s/companies?tag=CN_OVERSEAS')
  await page.getByTestId(`company-card-${companyIds[0]}`).click()
  const panel = page.getByTestId('company-jobs-panel')
  await expect(panel.getByRole('heading', { name: companyNames[0], exact: true })).toBeInViewport()
  await noOverflow(page)
  await screenshot(page, 'companies-panel-mobile')
  await panel.locator(`a[href="/zh/s/jobs/${hiddenJobId}"]`).click()
  const details = page.getByRole('dialog', { name: '职位详情', exact: true })
  await expect(details).toBeVisible()
  await expect(details.getByRole('heading', { name: `${keyword} Hidden Salary`, exact: true })).toBeVisible()
  await expect(details).not.toContainText('987653')
  await noOverflow(page)
  await screenshot(page, 'job-modal-mobile')
  await page.keyboard.press('Escape')
  await expect(details).toBeHidden()
  await page.goto(`/en/s/jobs/${jobId}`)
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.getByLabel('Key facts')).toContainText('Internship')
})

test('job links outside card grids restore keyboard focus after closing details', async ({ page }) => {
  const profile = await student(page)
  await e2eDb.application.create({ data: { studentId: profile.id, jobId } })
  await page.goto('/zh/s/applications')
  const opener = page.getByRole('link', { name: `${keyword} Product Intern`, exact: true })
  await opener.focus()
  await page.keyboard.press('Enter')
  const details = page.getByRole('dialog', { name: '职位详情', exact: true })
  await expect(details).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(details).toBeHidden()
  await expect(opener).toBeFocused()
})

test('a job removed after listing stays dismissible without recording a view', async ({ page }) => {
  const profile = await student(page)
  await page.goto(`/zh/s/jobs?q=${keyword}`)
  const opener = page.locator(`main a[href="/zh/s/jobs/${hiddenJobId}"]`)
  await expect(opener).toBeVisible()
  await e2eDb.job.update({ where: { id: hiddenJobId }, data: { status: 'DRAFT' } })
  try {
    await opener.click()
    const details = page.getByRole('dialog', { name: '职位详情', exact: true })
    await expect(details).toBeVisible()
    await expect(details).toContainText('该职位已不可用')
    await expect(details).not.toContainText(`Protected job description ${unique}`)
    await page.keyboard.press('Escape')
    await expect(details).toBeHidden()
    await expect(opener).toBeFocused()
    expect(await e2eDb.jobView.count({ where: { studentId: profile.id } })).toBe(0)
  } finally {
    await e2eDb.job.update({ where: { id: hiddenJobId }, data: { status: 'PUBLISHED' } })
  }
})

test('quota exhausted job modal omits protected content and remains dismissible', async ({ page }) => {
  const profile = await student(page)
  const source = await e2eDb.job.findUniqueOrThrow({ where: { id: jobId }, select: { createdById: true } })
  const fillerIds = Array.from({ length: 20 }, () => `c${randomBytes(12).toString('hex')}`)
  await e2eDb.job.createMany({ data: fillerIds.map(id => ({
    id, companyId: companyIds[1], createdById: source.createdById, title: 'Quota filler',
    type: 'INTERNSHIP', status: 'DRAFT', workMode: 'ONSITE', description: 'Synthetic quota fixture',
  })) })
  await e2eDb.jobView.createMany({ data: fillerIds.map(id => ({ studentId: profile.id, jobId: id })) })
  await page.goto(`/zh/s/jobs?q=${keyword}`)
  await page.locator(`main a[href="/zh/s/jobs/${jobId}"]`).click()
  const details = page.getByRole('dialog', { name: '职位详情', exact: true })
  await expect(details).toBeVisible()
  await expect(details).toContainText('查看额度已用完')
  await expect(details).not.toContainText(`Protected job description ${unique}`)
  await expect(details).not.toContainText('Bilingual communication')
  await expect(details.getByRole('button', { name: '立即投递', exact: true })).toHaveCount(0)
  await page.keyboard.press('Escape')
  await expect(details).toBeHidden()
  expect(await e2eDb.jobView.count({ where: { studentId: profile.id } })).toBe(20)
})

test('company job pagination preserves the selected company and filter', async ({ page }) => {
  await student(page)
  const source = await e2eDb.job.findUniqueOrThrow({ where: { id: jobId }, select: { createdById: true } })
  const ids = Array.from({ length: 23 }, () => `c${randomBytes(12).toString('hex')}`)
  await e2eDb.job.createMany({ data: ids.map((id, i) => ({
    id, companyId: companyIds[0], createdById: source.createdById, title: `Pagination Role ${i} ${unique}`,
    type: 'INTERNSHIP', workMode: 'ONSITE', status: 'PUBLISHED', publishedAt: new Date(), description: 'Private pagination body',
  })) })
  try {
    await page.goto(`/zh/s/companies?tag=CN_OVERSEAS&company=${companyIds[0]}`)
    const panel = page.getByTestId('company-jobs-panel')
    const firstIds = await panel.locator('a[href*="/s/jobs/"]').evaluateAll(links => links.map(a => a.getAttribute('href')))
    expect(firstIds).toHaveLength(20)
    await panel.locator('a[href*="jobsCursor="]').click()
    await expect(page).toHaveURL(new RegExp(`company=${companyIds[0]}`))
    await expect(page).toHaveURL(/tag=CN_OVERSEAS/)
    await expect(page).toHaveURL(/jobsCursor=/)
    await expect(panel.getByRole('heading', { name: companyNames[0], exact: true })).toBeVisible()
    const secondIds = await panel.locator('a[href*="/s/jobs/"]').evaluateAll(links => links.map(a => a.getAttribute('href')))
    expect(secondIds).toHaveLength(5)
    expect(secondIds.filter(id => firstIds.includes(id))).toEqual([])
    await page.getByTestId(`company-card-${companyIds[1]}`).click()
    await expect(page).not.toHaveURL(/jobsCursor=/)
  } finally {
    await e2eDb.job.deleteMany({ where: { id: { in: ids } } })
  }
})
