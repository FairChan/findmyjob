/**
 * M4-T17 mobile acceptance against real pages, settings and unlock actions.
 * Run with --workers=1: these cases temporarily change global feature flags.
 * Every case restores the exact setting rows and deletes its synthetic records.
 */
import { randomUUID } from 'node:crypto'
import { Prisma, type SystemSetting } from '@prisma/client'
import { test, expect, type BrowserContext, type Page, type TestInfo } from '@playwright/test'
import { e2eDb as db } from './helpers/db'
import { loginAs } from './helpers/session'
import { expectPageHealthy } from './helpers/smoke'
import { checkA11y } from './helpers/a11y'

const SETTING_KEYS = ['unlock.costCredits', 'unlock.enabled', 'billing.enabled'] as const
type SettingKey = (typeof SETTING_KEYS)[number]
const COST = 7
const VIEWPORT = { width: 375, height: 812 }
const COPY = {
  zh: {
    button: '解锁（消耗 7 点）',
    title: '解锁候选人',
    cost: '将消耗 7 个点数',
    confirm: '确认解锁',
    cancel: '取消',
    insufficient: '点数不足，无法解锁。试点期点数将于下月 1 日补发。',
    source: '投递自动授权',
    navigation: '学生导航',
    privacy: '隐私中心',
  },
  en: {
    button: 'Unlock (uses 7 credits)',
    title: 'Unlock Candidate',
    cost: 'This will use 7 credit(s)',
    confirm: 'Confirm Unlock',
    cancel: 'Cancel',
    insufficient: 'Insufficient credits. Pilot credits will be replenished on the 1st of next month.',
    source: 'Granted through an application',
    navigation: 'Student navigation',
    privacy: 'Privacy Centre',
  },
} as const

async function saveSetting(page: Page, key: SettingKey, value: number | boolean) {
  // High-impact keys include a P1 badge inside the same cell.
  const row = page.locator('tr').filter({ has: page.getByText(key) })
  if (typeof value === 'boolean') await row.locator('select').selectOption(String(value))
  else await row.locator('input').fill(String(value))
  await row.getByRole('button', { name: 'Save', exact: true }).click()
  if (typeof value === 'boolean') {
    await page.getByRole('dialog').getByRole('button', { name: 'Confirm', exact: true }).click()
  }
  await expect.poll(async () => (await db.systemSetting.findUnique({ where: { key } }))?.value)
    .toBe(value)
  await expect(row.getByText('Saved', { exact: true })).toBeVisible()
}

async function screenshot(page: Page, info: TestInfo, name: string) {
  const path = info.outputPath(`${name}.png`)
  await page.screenshot({ path, fullPage: true })
  await info.attach(name, { path, contentType: 'image/png' })
}

async function expectNoHorizontalOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true)
}

test.describe('M4-T17: mobile unlock and privacy guards', () => {
  test.describe.configure({ mode: 'serial' })
  test.setTimeout(240_000)

  let originalSettings: SystemSetting[] = []
  let settingsTouched = false
  let userIds: string[] = []
  let companyIds: string[] = []
  let contexts: BrowserContext[] = []

  test.beforeEach(async () => {
    // A serial describe only serializes this file, not other files. Refuse to
    // mutate shared flags while unrelated E2E workers could be reading them.
    expect(test.info().config.workers, 'Run m4-t17-guards.spec.ts with --workers=1').toBe(1)
    originalSettings = await db.systemSetting.findMany({ where: { key: { in: [...SETTING_KEYS] } } })
    settingsTouched = false
    userIds = []
    companyIds = []
    contexts = []
  })

  test.afterEach(async () => {
    test.info().setTimeout(90_000)
    try {
      if (settingsTouched) {
        await db.$transaction(async (tx) => {
          for (const key of SETTING_KEYS) {
            const original = originalSettings.find((row) => row.key === key)
            if (original) {
              const data = {
                value: original.value === null ? Prisma.JsonNull : original.value as Prisma.InputJsonValue,
                updatedById: original.updatedById,
                updatedAt: original.updatedAt,
              }
              await tx.systemSetting.upsert({ where: { key }, create: { key, ...data }, update: data })
            } else {
              await tx.systemSetting.deleteMany({ where: { key } })
            }
          }
        })
      }
    } finally {
      try {
        // Company/Profile relations cascade views, unlocks and memberships. A
        // failed zero-balance unlock must never create an append-only ledger row.
        await db.company.deleteMany({ where: { id: { in: companyIds } } })
        await db.user.deleteMany({ where: { id: { in: userIds } } })
      } finally {
        await Promise.all(contexts.map((context) => context.close()))
        if (settingsTouched) {
          // The dev server can hold separate 60 s settings caches per route
          // bundle. Expire every copy after DB restoration before the next spec.
          await new Promise<void>((resolve) => setTimeout(resolve, 61_000))
        }
      }
    }
  })

  for (const locale of ['zh', 'en'] as const) {
    test(`${locale}: 375px cost, pilot failure, disabled unlock and application privacy`, async ({ browser }, info) => {
      const copy = COPY[locale]
      const suffix = randomUUID().slice(0, 8)
      const companyName = `M4T17 ${locale} ${suffix}`
      const employerContext = await browser.newContext({ viewport: VIEWPORT })
      const studentContext = await browser.newContext({ viewport: VIEWPORT })
      const adminContext = await browser.newContext()
      contexts.push(employerContext, studentContext, adminContext)
      const employerPage = await employerContext.newPage()
      const studentPage = await studentContext.newPage()
      const adminPage = await adminContext.newPage()

      const student = await loginAs(studentPage, { role: 'STUDENT' })
      userIds.push(student.userId)
      const profile = await db.studentProfile.upsert({
        where: { userId: student.userId },
        create: {
          userId: student.userId,
          fullName: `M4T17 Student ${suffix}`,
          headline: 'Synthetic mobile acceptance profile',
          visibility: 'PUBLIC',
          schoolVerifiedAt: new Date(),
          completeness: 100,
          onboardingStep: 5,
        },
        update: { visibility: 'PUBLIC', schoolVerifiedAt: new Date(), completeness: 100, onboardingStep: 5 },
      })
      const employer = await loginAs(employerPage, {
        role: 'EMPLOYER', company: { verificationStatus: 'VERIFIED' },
      })
      userIds.push(employer.userId)
      if (!employer.companyId) throw new Error('Synthetic employer has no company')
      const companyId = employer.companyId
      companyIds.push(companyId)
      await db.company.update({ where: { id: companyId }, data: { legalName: companyName } })
      await db.creditWallet.create({ data: { companyId, balance: 0 } })

      const admin = await loginAs(adminPage, { role: 'ADMIN' })
      userIds.push(admin.userId)
      await expectPageHealthy(adminPage, '/en/admin/settings')
      settingsTouched = true
      await saveSetting(adminPage, 'unlock.costCredits', COST)
      await saveSetting(adminPage, 'billing.enabled', false)
      await saveSetting(adminPage, 'unlock.enabled', true)

      const detailPath = `/${locale}/e/talent/${profile.id}`
      // Poll the actual page until all server route copies observe the setting.
      await expect(async () => {
        await expectPageHealthy(employerPage, detailPath)
        await expect(employerPage.getByTestId('unlock-button')).toHaveText(copy.button)
      }).toPass({ timeout: 70_000, intervals: [1_000, 5_000] })
      await expectNoHorizontalOverflow(employerPage)
      await screenshot(employerPage, info, `${locale}-375-unlock-cost`)

      await employerPage.getByTestId('unlock-button').click()
      const dialog = employerPage.getByRole('dialog', { name: copy.title, exact: true })
      await expect(dialog).toBeVisible()
      // The semantic utilities previously compiled to nothing, leaving the
      // panel and primary button transparent despite passing functional checks.
      await expect(dialog).toHaveCSS('background-color', 'rgb(255, 255, 255)')
      await expect(dialog.getByRole('button', { name: copy.confirm, exact: true }))
        .toHaveCSS('background-color', 'rgb(15, 23, 42)')
      await expect(dialog.getByRole('button', { name: copy.confirm, exact: true }))
        .toHaveCSS('color', 'rgb(248, 250, 252)')
      await expect(dialog.getByText(copy.cost, { exact: true })).toBeVisible()
      await expect(dialog).not.toContainText('{cost}')
      await checkA11y(employerPage)
      await screenshot(employerPage, info, `${locale}-375-unlock-confirmation`)
      await expect(async () => {
        // billing.enabled and the action's unlock.enabled may be cached in
        // different bundles. Retry the real zero-balance request until both
        // observe the configured pilot mode; no attempt can debit this wallet.
        await employerPage.goto(detailPath)
        await employerPage.getByTestId('unlock-button').click()
        await expect(dialog.getByText(copy.cost, { exact: true })).toBeVisible()
        await dialog.getByRole('button', { name: copy.confirm, exact: true }).click()
        await expect(dialog.getByRole('alert')).toHaveText(copy.insufficient, { timeout: 10_000 })
      }).toPass({ timeout: 70_000, intervals: [1_000, 5_000] })
      await expectNoHorizontalOverflow(employerPage)
      await screenshot(employerPage, info, `${locale}-375-pilot-insufficient`)
      await checkA11y(employerPage)
      expect(await db.creditWallet.findUnique({ where: { companyId } })).toMatchObject({ balance: 0 })
      expect(await db.creditLedger.count({ where: { wallet: { companyId } } })).toBe(0)
      expect(await db.talentUnlock.count({ where: { companyId, studentId: profile.id } })).toBe(0)
      await dialog.getByRole('button', { name: copy.cancel, exact: true }).click()

      await saveSetting(adminPage, 'unlock.enabled', false)
      await expect(async () => {
        await expectPageHealthy(employerPage, detailPath)
        await expect(employerPage.getByTestId('unlock-button')).toHaveCount(0)
      }).toPass({ timeout: 70_000, intervals: [1_000, 5_000] })
      await screenshot(employerPage, info, `${locale}-375-unlock-disabled`)

      // Independent APPLICATION fixture exercises the real privacy serializer
      // and navigation without sending an application or notifying another user.
      await db.talentUnlock.create({
        data: {
          companyId, studentId: profile.id, unlockedById: student.userId,
          source: 'APPLICATION', creditsSpent: 0,
        },
      })
      await expectPageHealthy(studentPage, `/${locale}/s/privacy`)
      const navigation = studentPage.getByRole('navigation', { name: copy.navigation, exact: true })
      await expect(navigation).toBeVisible()
      await expect(navigation.getByRole('link', { name: copy.privacy, exact: true })).toHaveAttribute('href', `/${locale}/s/privacy`)
      const unlocks = studentPage.locator('[aria-labelledby="unlocks-heading"]')
      const application = unlocks.getByRole('listitem').filter({ hasText: companyName })
      await expect(application).toHaveCount(1)
      await expect(application.getByText(copy.source, { exact: true })).toBeVisible()
      await expectNoHorizontalOverflow(studentPage)
      await screenshot(studentPage, info, `${locale}-375-application-privacy`)
    })
  }
})
