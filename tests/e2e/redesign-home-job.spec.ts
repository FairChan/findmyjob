/**
 * Frontend redesign P1: the two sample pages (home, job detail).
 * Covers the brand headline, the hero search hand-off to /jobs, and the job detail
 * fact strip + apply action for a signed-in student.
 *
 * Set REDESIGN_SHOT_DIR to also write full-page screenshots there.
 */
import path from 'node:path'
import { test, expect, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { loginAs } from './helpers/session'
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

async function createPublishedJob() {
  const company = await e2eDb.company.create({
    data: {
      legalName: `Redesign Sample Sdn Bhd ${Date.now()}`,
      displayNameZh: '示例科技有限公司',
      displayNameEn: 'Sample Tech Sdn Bhd',
      verificationStatus: 'VERIFIED',
      isActive: true,
    },
  })
  const owner = await e2eDb.user.create({
    data: {
      name: 'Redesign Owner',
      email: `redesign-owner-${Date.now()}@example.test`,
      emailVerified: true,
      role: 'EMPLOYER',
      status: 'ACTIVE',
    },
  })
  return e2eDb.job.create({
    data: {
      companyId: company.id,
      createdById: owner.id,
      title: 'Marketing Intern (Mandarin-speaking)',
      type: 'INTERNSHIP',
      workMode: 'HYBRID',
      state: 'Selangor',
      city: 'Petaling Jaya',
      salaryMin: 1200,
      salaryMax: 1800,
      salaryVisible: true,
      headcount: 2,
      languages: ['中文', 'English'],
      skills: ['Social media', 'Copywriting', 'Canva'],
      acceptsStudentPass: true,
      description:
        'Support the marketing team on weekly campaigns.\nDraft bilingual social posts and track their results.',
      requirements: 'Currently enrolled at a Malaysian university.\nFluent Mandarin; working English.',
      benefits: 'Monthly allowance, flexible hours during exam weeks.',
      status: 'PUBLISHED',
      publishedAt: new Date(),
    },
  })
}

test.describe('redesign: home', () => {
  test('zh headline states the brand line and rests on the first adjective', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.goto('/zh')
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(/在马来西亚读书，找到我的第一份工作/)
    await expect(page.getByTestId('hero-word')).toHaveAttribute('data-word', '第一份')
    // Reduced motion: the word stays put.
    await page.waitForTimeout(2500)
    await expect(page.getByTestId('hero-word')).toHaveAttribute('data-typed', '第一份')
    await expectNoSeriousA11y(page)
    await shot(page, 'home-zh-1440')
  })

  test('en headline types the adjectives one after another', async ({ page }) => {
    await page.goto('/en')
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      /Finding my first Job While Studying in Malaysia/,
    )
    const word = page.getByTestId('hero-word')
    // Starts on the full first word, then backspaces it and types the next ones.
    await expect(word).toHaveAttribute('data-typed', 'first')
    await expect(word).toHaveAttribute('data-typed', 'dream', { timeout: 6000 })
    await expect(word).toHaveAttribute('data-typed', 'right', { timeout: 6000 })
    // The collage is decoration only.
    await expect(page.locator('main img[src*="malaysia"]').first()).toHaveAttribute('alt', '')
    await expect(page.getByRole('heading', { level: 2, name: 'What students say' })).toBeVisible()
    await expect(page.getByText('Sample quotes, shown for preview only.')).toBeVisible()
    await shot(page, 'home-en-1440')
  })

  test('hero invites visitors to sign in and gives members a working search', async ({ page }) => {
    await page.goto('/zh')
    await expect(page.getByRole('searchbox')).toHaveCount(0)
    await expect(page.getByRole('link', { name: '登录查看更多职位', exact: true })).toHaveAttribute('href', /\/zh\/login\?redirect=/)
    await loginAs(page, { role: 'STUDENT' })
    await page.goto('/zh')
    await page.getByRole('searchbox', { name: '搜索职位' }).fill('marketing')
    await page.getByRole('button', { name: '搜索', exact: true }).click()
    await expect(page).toHaveURL(/\/zh\/s\/jobs\?q=marketing/)
    await expect(page.locator('#jobs-q')).toHaveValue('marketing')
  })

  test('375px: headline and search fit without horizontal scroll', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 })
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.goto('/zh')
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    )
    expect(overflow).toBeLessThanOrEqual(0)
    await shot(page, 'home-zh-375')
  })
})

test.describe('redesign: job detail', () => {
  test('student sees the fact strip and can open the apply dialog', async ({ page }) => {
    const job = await createPublishedJob()
    const { userId } = await loginAs(page, { role: 'STUDENT' })
    await e2eDb.studentProfile.create({
      data: { userId, fullName: 'Redesign Student', completeness: 80, visibility: 'PUBLIC' },
    })

    await page.goto(`/zh/jobs/${job.id}`)
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Marketing Intern (Mandarin-speaking)')
    await expect(page.getByText('示例科技有限公司')).toBeVisible()

    const facts = page.getByLabel('职位要点')
    await expect(facts).toContainText('实习')
    await expect(facts).toContainText('混合办公')
    await expect(facts).toContainText('Petaling Jaya')
    await expect(facts).toContainText('2 人')
    await expect(page.getByText('MYR 1,200 – 1,800')).toBeVisible()
    await expect(page.getByText('接受学生准证')).toBeVisible()

    await expectNoSeriousA11y(page)
    await shot(page, 'job-zh-1440')

    // The apply action still goes through the existing dialog and Server Action.
    await page.getByRole('button', { name: '立即投递' }).click()
    await expect(page.getByRole('dialog')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog')).toBeHidden()

    await page.goto(`/en/jobs/${job.id}`)
    await expect(page.getByLabel('Key facts')).toContainText('Internship')
    await shot(page, 'job-en-1440')

    await page.setViewportSize({ width: 375, height: 812 })
    await page.goto(`/zh/jobs/${job.id}`)
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    )
    expect(overflow).toBeLessThanOrEqual(0)
    await shot(page, 'job-zh-375')
  })
})
