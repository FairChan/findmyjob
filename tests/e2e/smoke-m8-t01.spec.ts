/**
 * M8-T01 browser coverage; run with --workers=1 and an exclusive local *_test DB.
 * Real loginAs ADMIN 2FA; no mocked action responses, payment providers or production data.
 * Billing is changed through the existing settings UI and restored in afterEach.
 */
import { randomUUID } from 'node:crypto'
import type { Plan, Prisma } from '@prisma/client'
import { test, expect, type BrowserContext, type Locator, type Page, type TestInfo } from '@playwright/test'
import zh from '../../messages/zh.json'
import en from '../../messages/en.json'
import { e2eDb as db } from './helpers/db'
import { loginAs, type LoginOpts } from './helpers/session'
import { expectPageHealthy } from './helpers/smoke'
import { checkA11y } from './helpers/a11y'

const COPY = { zh, en }
type Locale = keyof typeof COPY
const MAX_INT = 2147483647

// Auth enrollment secrets must not be recorded in automatic traces.
test.use({ trace: 'off', screenshot: 'off', video: 'off', viewport: { width: 375, height: 900 } })

test.describe('M8-T01 plans administration and public pricing', () => {
  test.setTimeout(240_000)
  let marker = ''
  let sequence = 0
  let users: string[] = []
  let companies: string[] = []
  let extraPlanIds: string[] = []
  let contexts: BrowserContext[] = []
  let billingTouched = false
  let billingBefore: boolean | undefined
  let billingRowExisted = false
  let studentBillingBefore: unknown

  test.beforeEach(async () => {
    expect(test.info().config.workers, 'Run only this spec with --workers=1 and an exclusive test DB').toBe(1)
    marker = 'M8T01_' + randomUUID().replaceAll('-', '').slice(0, 12).toUpperCase()
    sequence = 0
    users = []
    companies = []
    extraPlanIds = []
    contexts = []
    billingTouched = false
    billingBefore = undefined
    billingRowExisted = false
    studentBillingBefore = (await db.systemSetting.findUnique({
      where: { key: 'billing.studentEnabled' }, select: { value: true },
    }))?.value ?? false
    expect(studentBillingBefore, 'Student billing must remain disabled in the T01 fixture').toBe(false)
  })

  async function login(page: Page, opts: LoginOpts) {
    const result = await loginAs(page, opts)
    users.push(result.userId)
    if (result.companyId) companies.push(result.companyId)
    return result
  }

  async function writeBillingThroughUi(page: Page, value: boolean) {
    await expectPageHealthy(page, '/en/admin/settings')
    const row = page.getByRole('row').filter({
      has: page.getByRole('cell', { name: 'billing.enabled', exact: true }),
    })
    await row.getByRole('combobox').selectOption(String(value))
    await row.getByRole('button', { name: en.adminSettings.save, exact: true }).click()
    await page.getByRole('dialog', { name: en.adminSettings.confirmTitle, exact: true })
      .getByRole('button', { name: en.adminSettings.confirmOk, exact: true }).click()
    await expect(row.getByText(en.adminSettings.saved, { exact: true })).toBeVisible()
    await expect.poll(async () => (await db.systemSetting.findUnique({
      where: { key: 'billing.enabled' }, select: { value: true },
    }))?.value).toBe(value)
  }

  async function billing(page: Page, value: boolean) {
    if (!billingTouched) {
      const original = await db.systemSetting.findUnique({
        where: { key: 'billing.enabled' }, select: { value: true },
      })
      expect(original?.value ?? false, 'Billing baseline must be a boolean').toEqual(expect.any(Boolean))
      billingBefore = (original?.value ?? false) as boolean
      billingRowExisted = original !== null
      // Track before the first click, including a failure after server commit.
      billingTouched = true
    }
    await writeBillingThroughUi(page, value)
  }

  test.afterEach(async ({ page }) => {
    let restoreFailure: unknown
    try {
      if (billingTouched) {
        try {
          await writeBillingThroughUi(page, billingBefore!)
          if (!billingRowExisted) {
            await db.systemSetting.deleteMany({ where: { key: 'billing.enabled' } })
          }
        } catch (error) {
          restoreFailure = error
          // Restore DB even after a failed browser cleanup. The parent must stop
          // the owned server after this failure so no stale setting cache survives.
          if (billingRowExisted) {
            await db.systemSetting.upsert({
              where: { key: 'billing.enabled' },
              create: { key: 'billing.enabled', value: billingBefore! },
              update: { value: billingBefore! },
            })
          } else {
            await db.systemSetting.deleteMany({ where: { key: 'billing.enabled' } })
          }
        }
      }
    } finally {
      await Promise.all(contexts.map((context) => context.close()))
      if (!/^M8T01_[A-F0-9]{12}$/.test(marker)) throw new Error('Refusing cleanup without a per-case marker')
      await db.subscription.deleteMany({ where: { companyId: { in: companies } } })
      await db.order.deleteMany({ where: { companyId: { in: companies } } })
      await db.plan.deleteMany({
        where: { OR: [{ code: { startsWith: marker } }, { id: { in: extraPlanIds } }] },
      })
      await db.company.deleteMany({ where: { id: { in: companies } } })
      await db.user.deleteMany({ where: { id: { in: users } } })
      // AuditLog is append-only: never delete acceptance evidence.
      expect((await db.systemSetting.findUnique({
        where: { key: 'billing.studentEnabled' }, select: { value: true },
      }))?.value ?? false).toEqual(studentBillingBefore)
    }
    if (restoreFailure) throw new Error('Billing DB baseline restored, but UI cleanup failed; stop the owned server before another run', { cause: restoreFailure })
  })

  async function seedPlan(changes: Partial<Prisma.PlanCreateInput> = {}) {
    sequence++
    return db.plan.create({
      data: {
        code: marker + '_' + sequence, kind: 'PLAN',
        nameZh: marker + ' 中文方案 ' + sequence, nameEn: marker + ' English plan ' + sequence,
        priceSen: 299900, credits: 120, durationDays: 365,
        jobPostLimit: 10, seatLimit: 3, invitationQuota: 200,
        isPublic: true, isActive: true, sortOrder: 0, ...changes,
      },
    })
  }

  async function ensureFree() {
    const existing = await db.plan.findUnique({ where: { code: 'FREE' } })
    if (existing) {
      expect(existing).toMatchObject({ kind: 'PLAN', priceSen: 0, credits: 0, durationDays: null, isActive: true, isPublic: true })
      expect(existing.jobPostLimit).not.toBeNull()
      expect(existing.seatLimit).not.toBeNull()
      expect(existing.invitationQuota).not.toBeNull()
      return existing
    }
    const row = await seedPlan({
      code: 'FREE', nameZh: marker + ' 免费方案', nameEn: marker + ' Free plan',
      priceSen: 0, credits: 0, durationDays: null, jobPostLimit: 2, seatLimit: 3, invitationQuota: 20,
    })
    extraPlanIds.push(row.id)
    return row
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

  async function adminPage(page: Page, locale: Locale, query = '') {
    const c = COPY[locale].adminPlans
    await expectPageHealthy(page, '/' + locale + '/admin/plans' + query)
    await expect(page.getByRole('heading', { name: c.title, exact: true, level: 1 })).toBeVisible()
    await expect(page.getByRole('navigation', { name: 'Admin navigation' })
      .getByRole('link', { name: COPY[locale].adminLayout.navPlans, exact: true }))
      .toHaveAttribute('aria-current', 'page')
    await expect(page.getByRole('link', { name: c.openPricing, exact: true })).toHaveAttribute('href', '/' + locale + '/pricing')
  }

  async function findRow(page: Page, locale: Locale, id: string) {
    for (let index = 0; index < 100; index++) {
      const row = page.getByTestId('plan-' + id)
      if (await row.count()) return row
      const next = page.getByRole('link', { name: COPY[locale].adminPlans.next, exact: true })
      if (!(await next.count())) break
      await next.click()
    }
    throw new Error('Synthetic plan not found in admin pagination')
  }

  async function edit(page: Page, locale: Locale, row: Plan) {
    await adminPage(page, locale)
    await (await findRow(page, locale, row.id)).getByRole('button', { name: COPY[locale].adminPlans.edit, exact: true }).click()
    return page.getByRole('dialog', { name: COPY[locale].adminPlans.editTitle, exact: true })
  }

  async function fillAnnual(dialog: Locator, locale: Locale, code: string) {
    const c = COPY[locale].adminPlans
    await dialog.getByLabel(c.code, { exact: true }).fill(code)
    await dialog.getByLabel(c.kind, { exact: true }).selectOption('PLAN')
    await dialog.getByLabel(c.nameZh, { exact: true }).fill(marker + ' 中文套餐')
    await dialog.getByLabel(c.nameEn, { exact: true }).fill(marker + ' English plan')
    await dialog.getByLabel(c.priceSen, { exact: true }).fill('299900')
    await dialog.getByLabel(c.credits, { exact: true }).fill('120')
    await dialog.getByLabel(c.durationDays, { exact: true }).fill('365')
    await dialog.getByLabel(c.unlimitedJobs, { exact: true }).uncheck()
    await dialog.getByLabel(c.unlimitedSeats, { exact: true }).uncheck()
    await dialog.getByLabel(c.unlimitedInvitations, { exact: true }).uncheck()
    await dialog.getByLabel(c.jobPostLimit, { exact: true }).fill('10')
    await dialog.getByLabel(c.seatLimit, { exact: true }).fill('3')
    await dialog.getByLabel(c.invitationQuota, { exact: true }).fill('200')
    await dialog.getByLabel(c.sortOrder, { exact: true }).fill('0')
    await dialog.getByLabel(c.active, { exact: true }).check()
    await dialog.getByLabel(c.public, { exact: true }).check()
  }

  async function publicPayloads(page: Page) {
    const html = await page.request.get(page.url())
    const rsc = await page.request.get(page.url(), { headers: { RSC: '1' } })
    expect(html.status()).toBe(200)
    expect(rsc.status()).toBe(200)
    expect(html.headers()['content-type']).toContain('text/html')
    expect(rsc.headers()['content-type']).toContain('text/x-component')
    return [await html.text(), await rsc.text()]
  }

  async function success(page: Page, locale: Locale, key: 'saved' | 'deleted') {
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(page.getByTestId('plan-feedback')).toHaveAttribute('role', 'status')
    await expect(page.getByTestId('plan-feedback')).toHaveText(COPY[locale].adminPlans[key])
    await expect(page.getByTestId('plan-heading')).toBeFocused()
  }

  async function locked(field: Locator) {
    await expect(field).toHaveCount(1)
    await expect.poll(() => field.evaluate((element) =>
      element.matches(':disabled')
      || (element instanceof HTMLInputElement
        && ['text', 'number'].includes(element.type)
        && element.readOnly),
    )).toBe(true)
  }

  for (const locale of ['zh', 'en'] as const) {
    test(locale + ': real admin CRUD immediately updates anonymous prices and restores success focus', async ({ page, browser }, info) => {
      const c = COPY[locale].adminPlans
      const p = COPY[locale].pricing
      const actor = await login(page, { role: 'ADMIN' })
      expect(await db.session.count({ where: { userId: actor.userId, twoFactorVerifiedAt: { not: null } } })).toBeGreaterThan(0)
      await ensureFree()
      const hidden = await seedPlan({ isPublic: false })
      const inactive = await seedPlan({ isActive: false })
      const student = await seedPlan({ kind: 'STUDENT_VIEW_PACK', durationDays: null })
      const pack = await seedPlan({
        kind: 'CREDIT_PACK', priceSen: 29900, credits: 10, durationDays: null,
        jobPostLimit: null, seatLimit: null, invitationQuota: null,
      })
      await billing(page, true)
      await adminPage(page, locale)
      await evidence(page, info, locale + '-admin-plans')
      const code = marker + '_UI'
      expect(await db.plan.count({ where: { code } })).toBe(0)
      const trigger = page.getByRole('button', { name: c.new, exact: true })
      await trigger.click()
      let dialog = page.getByRole('dialog', { name: c.new, exact: true })
      await fillAnnual(dialog, locale, code)
      await evidence(page, info, locale + '-new-plan-dialog')
      await page.keyboard.press('Escape')
      await expect(dialog).toHaveCount(0)
      await expect(trigger).toBeFocused()
      await trigger.click()
      dialog = page.getByRole('dialog', { name: c.new, exact: true })
      await fillAnnual(dialog, locale, code)
      await dialog.getByRole('button', { name: c.save, exact: true }).click()
      await success(page, locale, 'saved')
      const created = await db.plan.findUniqueOrThrow({ where: { code } })
      expect(created).toMatchObject({
        nameZh: marker + ' 中文套餐', nameEn: marker + ' English plan',
        priceSen: 299900, credits: 120, durationDays: 365,
        jobPostLimit: 10, seatLimit: 3, invitationQuota: 200, isActive: true, isPublic: true,
      })
      expect(await db.auditLog.count({ where: { targetType: 'Plan', targetId: created.id, action: 'plan.create', actorId: actor.userId } })).toBe(1)
      const guest = await browser.newContext({ viewport: { width: 375, height: 900 } })
      contexts.push(guest)
      const publicPage = await guest.newPage()
      await expectPageHealthy(publicPage, '/' + locale + '/pricing')
      let card = publicPage.getByTestId('pricing-plan-' + created.id)
      await expect(card.getByRole('heading', { name: locale === 'zh' ? created.nameZh : created.nameEn, exact: true })).toBeVisible()
      await expect(card.getByTestId('plan-price')).toContainText('MYR')
      await expect(card.getByTestId('plan-price')).toContainText('2,999.00')
      await expect(card.getByTestId('plan-credits')).toHaveText('120')
      await expect(card.getByTestId('plan-duration')).toHaveText('365')
      await expect(card.getByTestId('plan-jobs')).toHaveText('10')
      await expect(card.getByTestId('plan-seats')).toHaveText('3')
      await expect(card.getByTestId('plan-invitations')).toHaveText('200')
      const payloads = await publicPayloads(publicPage)
      for (const excluded of [hidden, inactive, student]) {
        await expect(publicPage.getByTestId('pricing-plan-' + excluded.id)).toHaveCount(0)
        await expect(publicPage.getByText(locale === 'zh' ? excluded.nameZh : excluded.nameEn, { exact: true })).toHaveCount(0)
        for (const payload of payloads) {
          expect(payload).not.toContain(excluded.nameZh)
          expect(payload).not.toContain(excluded.nameEn)
        }
      }
      const packCard = publicPage.getByTestId('pricing-plan-' + pack.id)
      await expect(packCard).toContainText(p.noSubscription)
      await expect(packCard).not.toContainText(p.unlimited)
      await expect(packCard.getByTestId('plan-price')).toContainText('299.00')
      await evidence(publicPage, info, locale + '-pricing-enabled')

      dialog = await edit(page, locale, created)
      await locked(dialog.getByLabel(c.code, { exact: true }))
      await locked(dialog.getByLabel(c.kind, { exact: true }))
      await dialog.getByLabel(c.priceSen, { exact: true }).fill('399901')
      await dialog.getByLabel(c.nameZh, { exact: true }).fill(marker + ' 新版中文套餐')
      await dialog.getByLabel(c.nameEn, { exact: true }).fill(marker + ' Updated English plan')
      for (const label of [c.unlimitedJobs, c.unlimitedSeats, c.unlimitedInvitations]) {
        await dialog.getByLabel(label, { exact: true }).check()
      }
      await dialog.getByRole('button', { name: c.save, exact: true }).click()
      await success(page, locale, 'saved')
      const changed = await db.plan.findUniqueOrThrow({ where: { id: created.id } })
      expect(changed).toMatchObject({ priceSen: 399901, jobPostLimit: null, seatLimit: null, invitationQuota: null })
      expect(changed.updatedAt.getTime()).toBeGreaterThan(created.updatedAt.getTime())
      // No setting TTL sleep: the very next public navigation must show the new price.
      await publicPage.reload()
      card = publicPage.getByTestId('pricing-plan-' + created.id)
      await expect(card.getByTestId('plan-price')).toContainText('3,999.01')
      await expect(card.getByRole('heading', { name: locale === 'zh' ? changed.nameZh : changed.nameEn, exact: true })).toBeVisible()
      for (const field of ['plan-jobs', 'plan-seats', 'plan-invitations']) {
        await expect(card.getByTestId(field)).toHaveText(p.unlimited)
      }

      dialog = await edit(page, locale, changed)
      await dialog.getByLabel(c.public, { exact: true }).uncheck()
      await dialog.getByRole('button', { name: c.save, exact: true }).click()
      await success(page, locale, 'saved')
      expect((await db.plan.findUniqueOrThrow({ where: { id: created.id } })).isPublic).toBe(false)
      await publicPage.reload()
      await expect(publicPage.getByTestId('pricing-plan-' + created.id)).toHaveCount(0)
      for (const payload of await publicPayloads(publicPage)) {
        expect(payload).not.toContain(changed.nameZh)
        expect(payload).not.toContain(changed.nameEn)
      }

      // The active filter removes the edited row; feedback and focus must survive.
      await adminPage(page, locale, '?active=true')
      await (await findRow(page, locale, created.id)).getByRole('button', { name: c.edit, exact: true }).click()
      dialog = page.getByRole('dialog', { name: c.editTitle, exact: true })
      await dialog.getByLabel(c.active, { exact: true }).uncheck()
      await dialog.getByRole('button', { name: c.save, exact: true }).click()
      await success(page, locale, 'saved')
      await expect(page.getByTestId('plan-' + created.id)).toHaveCount(0)
      expect((await db.plan.findUniqueOrThrow({ where: { id: created.id } })).isActive).toBe(false)

      await adminPage(page, locale)
      const row = await findRow(page, locale, created.id)
      const remove = row.getByRole('button', { name: c.delete, exact: true })
      await remove.click()
      dialog = page.getByRole('dialog', { name: c.deleteTitle, exact: true })
      await evidence(page, info, locale + '-delete-plan-dialog')
      await dialog.getByRole('button', { name: c.cancel, exact: true }).click()
      await expect(remove).toBeFocused()
      expect(await db.plan.findUnique({ where: { id: created.id } })).not.toBeNull()
      await remove.click()
      await page.getByRole('dialog', { name: c.deleteTitle, exact: true })
        .getByRole('button', { name: c.confirmDelete, exact: true }).click()
      await success(page, locale, 'deleted')
      expect(await db.plan.findUnique({ where: { id: created.id } })).toBeNull()
      expect(await db.auditLog.count({ where: { targetId: created.id, action: 'plan.delete', actorId: actor.userId } })).toBe(1)
    })

    test(locale + ': pilot is free-only with no paid data or checkout control', async ({ page, browser }, info) => {
      const p = COPY[locale].pricing
      await login(page, { role: 'ADMIN' })
      const free = await ensureFree()
      const paid = await seedPlan()
      await billing(page, false)
      const guest = await browser.newContext({ viewport: { width: 375, height: 900 } })
      contexts.push(guest)
      const publicPage = await guest.newPage()
      const response = await publicPage.goto('/' + locale + '/pricing')
      expect(response?.status()).toBe(200)
      const document = await response!.text()
      await expect(publicPage.getByRole('heading', { name: p.title, exact: true, level: 1 })).toBeVisible()
      await expect(publicPage.getByText(p.pilotTitle, { exact: true })).toBeVisible()
      await expect(publicPage.getByText(p.pilotDescription, { exact: true })).toBeVisible()
      await expect(publicPage.getByTestId('pricing-plan-' + free.id)).toBeVisible()
      await expect(publicPage.locator('[data-testid^="pricing-plan-"]')).toHaveCount(1)
      await expect(publicPage.getByTestId('pricing-plan-' + paid.id)).toHaveCount(0)
      for (const payload of [document, ...await publicPayloads(publicPage)]) {
        expect(payload).not.toContain(paid.nameEn)
        expect(payload).not.toContain(paid.nameZh)
      }
      await expect(publicPage.getByRole('button', { name: /buy|purchase|checkout|购买|支付/i })).toHaveCount(0)
      await expect(publicPage.locator('a[href*="/checkout"], a[href*="/billing"], form[action*="/orders"]')).toHaveCount(0)
      await evidence(publicPage, info, locale + '-pricing-pilot')
    })

    test(locale + ': stale updates show an actionable conflict and preserve the submitted draft', async ({ page }, info) => {
      const c = COPY[locale].adminPlans
      await login(page, { role: 'ADMIN' })
      const row = await seedPlan()
      let dialog = await edit(page, locale, row)
      await dialog.getByLabel(c.priceSen, { exact: true }).fill('499901')
      await dialog.getByLabel(c.nameEn, { exact: true }).fill(marker + ' Unsaved draft')
      const current = await db.plan.update({
        where: { id: row.id },
        data: { priceSen: 399900, updatedAt: new Date(row.updatedAt.getTime() + 1000) },
      })
      const auditsBefore = await db.auditLog.count({ where: { targetId: row.id } })
      await dialog.getByRole('button', { name: c.save, exact: true }).click()
      await expect(dialog.getByRole('alert')).toHaveText(c.errorStale)
      await expect(dialog.getByLabel(c.priceSen, { exact: true })).toHaveValue('499901')
      await expect(dialog.getByLabel(c.nameEn, { exact: true })).toHaveValue(marker + ' Unsaved draft')
      await expect(dialog.getByRole('button', { name: c.save, exact: true })).toBeEnabled()
      expect(await db.plan.findUnique({ where: { id: row.id } })).toEqual(current)
      expect(await db.auditLog.count({ where: { targetId: row.id } })).toBe(auditsBefore)
      await evidence(page, info, locale + '-stale-plan')
      await dialog.getByRole('button', { name: c.reloadLatest, exact: true }).click()
      await expect(page.getByRole('dialog')).toHaveCount(0)
      await (await findRow(page, locale, row.id)).getByRole('button', { name: c.edit, exact: true }).click()
      dialog = page.getByRole('dialog', { name: c.editTitle, exact: true })
      await expect(dialog.getByLabel(c.priceSen, { exact: true })).toHaveValue('399900')
    })

    test(locale + ': invalid input and duplicate code keep the form and do not create a plan', async ({ page }) => {
      const c = COPY[locale].adminPlans
      await login(page, { role: 'ADMIN' })
      const existing = await seedPlan()
      await adminPage(page, locale)
      await page.getByRole('button', { name: c.new, exact: true }).click()
      const dialog = page.getByRole('dialog', { name: c.new, exact: true })
      const newCode = marker + '_INVALID'
      await fillAnnual(dialog, locale, newCode)
      const price = dialog.getByLabel(c.priceSen, { exact: true })
      for (const invalid of ['-1', '1.5', String(MAX_INT + 1), '']) {
        await price.fill(invalid)
        await dialog.getByRole('button', { name: c.save, exact: true }).click()
        await expect(dialog).toBeVisible()
        await expect(price).toHaveValue(invalid)
        expect(await db.plan.count({ where: { code: newCode } })).toBe(0)
      }
      await price.fill('299900')
      const jobs = dialog.getByLabel(c.jobPostLimit, { exact: true })
      await jobs.fill('')
      await dialog.getByRole('button', { name: c.save, exact: true }).click()
      await expect(jobs).toHaveValue('')
      await expect(dialog.getByLabel(c.unlimitedJobs, { exact: true })).not.toBeChecked()
      expect(await db.plan.count({ where: { code: newCode } })).toBe(0)
      await jobs.fill('10')
      await dialog.getByLabel(c.code, { exact: true }).fill(existing.code)
      await dialog.getByRole('button', { name: c.save, exact: true }).click()
      await expect(dialog.getByRole('alert')).toHaveText(c.errorDuplicate)
      await expect(dialog.getByLabel(c.nameEn, { exact: true })).toHaveValue(marker + ' English plan')
      await expect(dialog.getByLabel(c.code, { exact: true })).toHaveValue(existing.code)
      expect(await db.plan.findUnique({ where: { id: existing.id } })).toEqual(existing)
      expect(await db.plan.count({ where: { code: newCode } })).toBe(0)
    })

    test(locale + ': FREE controls cannot delete, deactivate or charge for the system plan', async ({ page }, info) => {
      const c = COPY[locale].adminPlans
      await login(page, { role: 'ADMIN' })
      const free = await ensureFree()
      await adminPage(page, locale)
      const row = await findRow(page, locale, free.id)
      const remove = row.getByRole('button', { name: c.delete, exact: true })
      if (await remove.count()) await expect(remove).toBeDisabled()
      await row.getByRole('button', { name: c.edit, exact: true }).click()
      const dialog = page.getByRole('dialog', { name: c.editTitle, exact: true })
      await expect(dialog.getByText(c.freeProtected, { exact: true })).toBeVisible()
      for (const label of [c.code, c.kind, c.priceSen, c.credits, c.active]) {
        await locked(dialog.getByLabel(label, { exact: true }))
      }
      for (const label of [c.unlimitedJobs, c.unlimitedSeats, c.unlimitedInvitations]) {
        const input = dialog.getByLabel(label, { exact: true })
        if (await input.count()) await expect(input).toBeDisabled()
      }
      await expect(dialog.getByLabel(c.priceSen, { exact: true })).toHaveValue('0')
      await evidence(page, info, locale + '-free-protection')
      await dialog.getByRole('button', { name: c.cancel, exact: true }).click()
      expect(await db.plan.findUnique({ where: { id: free.id } })).toEqual(free)
    })

    test(locale + ': order and subscription references reject deletion with retained history', async ({ page }, info) => {
      const c = COPY[locale].adminPlans
      const actor = await login(page, { role: 'ADMIN' })
      const company = await db.company.create({ data: { legalName: marker + ' History company' } })
      companies.push(company.id)
      const ordered = await seedPlan()
      const subscribed = await seedPlan()
      const order = await db.order.create({
        data: {
          orderNo: marker + '-ORDER', companyId: company.id, planId: ordered.id,
          kind: 'PLAN', amountSen: ordered.priceSen, status: 'CANCELLED', createdById: actor.userId,
        },
      })
      const subscription = await db.subscription.create({
        data: {
          companyId: company.id, planId: subscribed.id, status: 'EXPIRED',
          startsAt: new Date('2025-01-01T00:00:00Z'), endsAt: new Date('2026-01-01T00:00:00Z'),
        },
      })
      for (const plan of [ordered, subscribed]) {
        await adminPage(page, locale)
        await (await findRow(page, locale, plan.id)).getByRole('button', { name: c.delete, exact: true }).click()
        const dialog = page.getByRole('dialog', { name: c.deleteTitle, exact: true })
        const auditBefore = await db.auditLog.count({ where: { targetId: plan.id, action: 'plan.delete' } })
        await dialog.getByRole('button', { name: c.confirmDelete, exact: true }).click()
        await expect(dialog.getByRole('alert')).toHaveText(c.errorReferenced)
        await expect(dialog.getByRole('button', { name: c.cancel, exact: true })).toBeEnabled()
        expect(await db.plan.findUnique({ where: { id: plan.id } })).toEqual(plan)
        expect(await db.auditLog.count({ where: { targetId: plan.id, action: 'plan.delete' } })).toBe(auditBefore)
        await evidence(page, info, locale + '-referenced-' + plan.id)
        await dialog.getByRole('button', { name: c.cancel, exact: true }).click()
      }
      expect(await db.order.findUnique({ where: { id: order.id } })).toEqual(order)
      expect(await db.subscription.findUnique({ where: { id: subscription.id } })).toEqual(subscription)
      const dialog = await edit(page, locale, ordered)
      await dialog.getByLabel(c.active, { exact: true }).uncheck()
      await dialog.getByRole('button', { name: c.save, exact: true }).click()
      await success(page, locale, 'saved')
      expect((await db.plan.findUniqueOrThrow({ where: { id: ordered.id } })).isActive).toBe(false)
      expect(await db.order.findUnique({ where: { id: order.id } })).toEqual(order)
    })

    test(locale + ': invalid query strings remain controlled and resettable', async ({ page }) => {
      const c = COPY[locale].adminPlans
      await login(page, { role: 'ADMIN' })
      for (const query of ['?active=maybe', '?active=true&active=false', '?limit=0', '?limit=101', '?cursor=bad-cursor']) {
        await adminPage(page, locale, query)
        await expect(page.getByRole('main').getByRole('alert')).toHaveText(c.errorQuery)
        await expect(page.locator('[data-testid^="plan-"]').filter({ has: page.getByRole('button', { name: c.edit, exact: true }) })).toHaveCount(0)
        await page.getByRole('link', { name: c.reset, exact: true }).click()
        await expect(page).toHaveURL(new RegExp('/' + locale + '/admin/plans$'))
        await expect(page.getByRole('main').getByRole('alert')).toHaveCount(0)
      }
    })

    test(locale + ': action rechecks revoked access while preserving the open form', async ({ page }) => {
      const c = COPY[locale].adminPlans
      const actor = await login(page, { role: 'ADMIN' })
      const row = await seedPlan()
      const dialog = await edit(page, locale, row)
      await dialog.getByLabel(c.nameEn, { exact: true }).fill(marker + ' Retained after revocation')
      await db.user.update({ where: { id: actor.userId }, data: { status: 'SUSPENDED' } })
      const auditBefore = await db.auditLog.count({ where: { targetId: row.id } })
      await dialog.getByRole('button', { name: c.save, exact: true }).click()
      await expect(dialog.getByRole('alert')).toHaveText(c.errorForbidden)
      await expect(dialog.getByLabel(c.nameEn, { exact: true })).toHaveValue(marker + ' Retained after revocation')
      await expect(dialog.getByRole('link', { name: c.signIn, exact: true })).toHaveAttribute('href', '/' + locale + '/login')
      expect(await db.plan.findUnique({ where: { id: row.id } })).toEqual(row)
      expect(await db.auditLog.count({ where: { targetId: row.id } })).toBe(auditBefore)
    })

    for (const role of ['anonymous', 'STUDENT', 'EMPLOYER', 'ADMIN_NO_2FA'] as const) {
      test(locale + ': direct plans URL denies ' + role, async ({ page }) => {
        if (role === 'STUDENT') await login(page, { role: 'STUDENT' })
        if (role === 'EMPLOYER') await login(page, { role: 'EMPLOYER' })
        if (role === 'ADMIN_NO_2FA') await login(page, { role: 'ADMIN', twoFactor: false })
        await page.goto('/' + locale + '/admin/plans')
        await expect(page).toHaveURL(new RegExp('/' + locale + (role === 'ADMIN_NO_2FA' ? '/two-factor/setup' : '/login')))
        await expect(page.getByRole('button', { name: COPY[locale].adminPlans.new, exact: true })).toHaveCount(0)
      })
    }
  }
})
