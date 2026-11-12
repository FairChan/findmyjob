/**
 * M8-T02: seven independent browser guards, real actions/upload/settlement.
 * Requires the agreed T02 UI/schema/action wiring. Missing modules are not RED.
 * Run only through the guarded local Playwright configuration, --workers=1.
 * Fault injection aborts requests before server execution; success is never mocked.
 * All screenshots contain synthetic data. No automatic trace/video/proof captures.
 */
import { test, expect } from '@playwright/test'
import { e2eDb as db } from './helpers/db'
import {
  BANK, BANK_KEY, COPY, PNG, BillingUiFixture, abortAction, attach,
  evidence, guardedSubmit, noDelivery, privatePayloadGuard, upload,
} from './helpers/billing-t02-ui'

test.use({ storageState: { cookies: [], origins: [] }, trace: 'off', screenshot: 'off', video: 'off' })

test.describe('M8-T02 bank orders and payment verification', () => {
  test.setTimeout(240_000)
  let fixture: BillingUiFixture

  test.beforeEach(async ({ page, browser, baseURL }) => {
    expect(test.info().config.workers, 'Run T02 browser guards with --workers=1').toBe(1)
    fixture = new BillingUiFixture(page, browser, baseURL)
    await fixture.init()
  })

  test.afterEach(async () => { if (fixture) await fixture.cleanup() })

  for (const locale of ['zh', 'en'] as const) {
    const c = COPY[locale]

    test(locale + ': labeled bank form, explicit current quote, guarded create and pending cancellation', async ({ page }, info) => {
      const form = await fixture.saveBank(page, locale)
      await expect(form).toHaveJSProperty('tagName', 'FORM')
      for (const [label, name] of [[c.bankName, 'bankName'], [c.accountName, 'accountName'], [c.accountNumber, 'accountNumber'], [c.instructions, 'instructions']]) {
        await expect(form.getByLabel(label, { exact: true })).toHaveAttribute('name', name)
      }
      await expect(form.getByLabel(c.accountNumber, { exact: true })).toHaveAttribute('type', 'text')
      await expect(form.getByLabel(c.accountNumber, { exact: true })).toHaveValue(BANK.accountNumber)
      await expect(page.getByRole('row').filter({ has: page.getByRole('cell', { name: BANK_KEY, exact: true }) })).toHaveCount(0)
      expect((await page.locator('input,textarea').evaluateAll((elements) => elements.some((element) =>
        (element as HTMLInputElement).value === '[object Object]',
      )))).toBe(false)
      await form.getByLabel(c.accountName, { exact: true }).fill(BANK.accountName + ' DRAFT')
      await abortAction(page, async () => {
        await form.getByRole('button', { name: c.saveBank, exact: true }).click()
        await expect(form.getByRole('alert')).toBeVisible()
      })
      await expect(form.getByLabel(c.accountName, { exact: true })).toHaveValue(BANK.accountName + ' DRAFT')
      await expect(form.getByLabel(c.bankName, { exact: true })).toHaveValue(BANK.bankName)
      await expect(form.getByLabel(c.accountNumber, { exact: true })).toHaveValue(BANK.accountNumber)
      expect((await db.systemSetting.findUniqueOrThrow({ where: { key: BANK_KEY } })).value).toEqual(BANK)
      await evidence(page, info, locale + '-bank-form-error', '[data-testid="bank-transfer-settings"]')
      await fixture.saveBank(page, locale)
      const bankAudits = await db.auditLog.findMany({ where: { actorId: { in: fixture.users }, targetId: BANK_KEY } })
      expect(bankAudits.length).toBeGreaterThan(0)
      expect(bankAudits.every((row) => {
        const metadata = JSON.stringify(row.metadata)
        return !metadata.includes(BANK.accountNumber) && !metadata.includes(BANK.accountName) && !metadata.includes(BANK.bankName)
      })).toBe(true)

      const owner = await fixture.owner()
      const plan = await fixture.plan()
      await fixture.founding(owner.actor.companyId, plan.code)
      const quotePath = '/' + locale + '/e/billing/new?planId=' + plan.id
      await owner.page.goto(quotePath)
      const quote = owner.page.getByTestId('billing-quote')
      await expect(quote).toHaveJSProperty('tagName', 'FORM')
      await expect(quote).toContainText(locale === 'zh' ? plan.nameZh : plan.nameEn)
      await expect(quote.getByTestId('quote-list-price')).toHaveText('MYR 2,999.00')
      await expect(quote.getByTestId('quote-discount')).toHaveText('MYR 1,499.50')
      await expect(quote.getByTestId('quote-payable')).toHaveText('MYR 1,499.50')
      await expect(quote.getByTestId('quote-credits')).toHaveText('120')
      expect(await db.order.count({ where: { companyId: owner.actor.companyId } })).toBe(0)
      await evidence(owner.page, info, locale + '-quote')
      // A genuine stale quote must not silently become a more expensive order.
      await db.plan.update({ where: { id: plan.id }, data: { priceSen: 299901 } })
      await quote.getByRole('button', { name: c.create, exact: true }).click()
      await expect(quote.getByRole('alert')).toHaveText(c.quoteChanged)
      await expect(quote.getByTestId('quote-payable')).toHaveText('MYR 1,499.50')
      expect(await db.order.count({ where: { companyId: owner.actor.companyId } })).toBe(0)
      await quote.getByRole('button', { name: c.refreshQuote, exact: true }).click()
      await expect(quote.getByTestId('quote-list-price')).toHaveText('MYR 2,999.01')
      await expect(quote.getByTestId('quote-discount')).toHaveText('MYR 1,499.50')
      await expect(quote.getByTestId('quote-payable')).toHaveText('MYR 1,499.51')
      expect(await db.order.count({ where: { companyId: owner.actor.companyId } })).toBe(0)
      await guardedSubmit(owner.page, quote, quote.getByRole('button', { name: c.create, exact: true }))
      await expect(owner.page).toHaveURL(new RegExp('/' + locale + '/e/billing/[^/?]+$'))
      const orderId = new URL(owner.page.url()).pathname.split('/').at(-1)!
      const order = await db.order.findUniqueOrThrow({ where: { id: orderId } })
      expect(order).toMatchObject({ companyId: owner.actor.companyId, status: 'PENDING', amountSen: 149951, discountSen: 149950, paymentMethod: 'BANK_TRANSFER' })
      expect(order.commercialSnapshot).toMatchObject({
        version: 1, money: { listPriceSen: 299901, discountSen: 149950, payableSen: 149951, currency: 'MYR' },
        delivery: { credits: 120 },
      })
      expect(await db.order.count({ where: { companyId: owner.actor.companyId } })).toBe(1)
      await owner.page.reload()
      await expect(owner.page.getByTestId('order-number')).toHaveText(order.orderNo)
      await expect(owner.page.getByTestId('order-amount')).toHaveText('MYR 1,499.51')
      await expect(owner.page.getByTestId('order-status')).toHaveText(c.pending)
      expect(await db.order.count({ where: { companyId: owner.actor.companyId } })).toBe(1)
      await noDelivery(order.id)
      const cancel = owner.page.getByRole('button', { name: c.cancelOrder, exact: true })
      await cancel.click()
      const dialog = owner.page.getByRole('dialog', { name: c.cancelOrder, exact: true })
      await expect(dialog).toBeVisible()
      await owner.page.keyboard.press('Escape')
      await expect(dialog).not.toBeVisible()
      await expect(cancel).toBeFocused()
      expect((await db.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe('PENDING')
      await cancel.click()
      await dialog.getByRole('button', { name: c.confirmCancel, exact: true }).click()
      const feedback = owner.page.getByRole('status').filter({ hasText: c.cancelled })
      await expect(feedback).toBeVisible()
      await expect(feedback).toBeFocused()
      await expect(owner.page.getByTestId('order-status')).toHaveText(c.cancelledStatus)
      await expect(owner.page.getByTestId('payment-proof-form')).toHaveCount(0)
      expect((await db.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe('CANCELLED')
      await noDelivery(order.id)
    })

    test(locale + ': missing bank configuration blocks new orders while historical proof upload and replacement recover', async ({}, info) => {
      const owner = await fixture.owner()
      const plan = await fixture.plan('CREDIT_PACK')
      const order = await fixture.create(owner.page, owner.actor.companyId, plan.id, locale)
      const orderPath = '/' + locale + '/e/billing/' + order.id
      for (const value of [{}, { bankName: 'SYNTHETIC INCOMPLETE BANK' }]) {
        // After a successful create, this also guards stale configuration caches.
        await fixture.setting(BANK_KEY, value)
        await owner.page.goto('/' + locale + '/e/billing/new?planId=' + plan.id)
        await expect(owner.page.getByTestId('bank-transfer-unavailable')).toHaveText(c.bankUnavailable)
        const create = owner.page.getByRole('button', { name: c.create, exact: true })
        if (await create.count()) await expect(create).toBeDisabled()
        await expect(owner.page.getByTestId('bank-transfer-details')).toHaveCount(0)
        expect((await owner.page.content()).includes(BANK.accountNumber)).toBe(false)
        expect(await db.order.count({ where: { companyId: owner.actor.companyId } })).toBe(1)
      }
      await evidence(owner.page, info, locale + '-bank-unavailable')
      await fixture.billing(false)
      const privacy = await privatePayloadGuard(owner.page)
      await owner.page.goto(orderPath)
      await expect(owner.page.getByTestId('bank-transfer-unavailable')).toHaveText(c.bankHistory)
      await expect(owner.page.getByTestId('order-amount')).toHaveText('MYR 2,999.00')
      const form = owner.page.getByTestId('payment-proof-form')
      const file = form.getByLabel(c.proof, { exact: true })
      await file.setInputFiles({ name: 'synthetic-proof.png', mimeType: 'image/png', buffer: PNG })
      await expect(form.getByRole('button', { name: c.upload, exact: true })).toBeEnabled()
      await owner.page.route('**/api/uploads/PAYMENT_PROOF', (route) => route.abort('failed'), { times: 1 })
      await form.getByRole('button', { name: c.upload, exact: true }).click()
      await expect(form.getByRole('alert')).toBeVisible()
      await expect(file).toHaveValue(/synthetic-proof\.png$/)
      expect(await db.paymentProofUpload.count({ where: { companyId: owner.actor.companyId } })).toBe(0)
      await evidence(owner.page, info, locale + '-upload-error')
      const firstKey = await upload(owner.page, locale)
      expect(await db.paymentProofUpload.count({ where: { companyId: owner.actor.companyId, storageKey: firstKey } })).toBe(1)
      expect(await db.order.findUniqueOrThrow({ where: { id: order.id } })).toMatchObject({ status: 'PENDING', proofKey: null })
      await noDelivery(order.id)
      await abortAction(owner.page, async () => {
        await form.getByRole('button', { name: c.submitProof, exact: true }).click()
        await expect(form.getByRole('alert')).toBeVisible()
      })
      await expect(form.getByText(c.uploaded, { exact: true })).toBeVisible()
      await expect(file).toHaveValue(/synthetic-proof\.png$/)
      expect((await db.order.findUniqueOrThrow({ where: { id: order.id } })).proofKey).toBeNull()
      await attach(owner.page, locale)
      expect(await db.paymentProofUpload.count({ where: { companyId: owner.actor.companyId } })).toBe(1)
      expect(await db.order.findUniqueOrThrow({ where: { id: order.id } })).toMatchObject({ status: 'AWAITING_CONFIRMATION', proofKey: firstKey })
      await expect(owner.page.getByRole('button', { name: c.cancelOrder, exact: true })).toHaveCount(0)
      await expect(owner.page.getByRole('link', { name: c.preview, exact: true })).toHaveCount(0)
      await evidence(owner.page, info, locale + '-awaiting-payment')
      const secondKey = await upload(owner.page, locale, 'synthetic-replacement.png')
      expect(secondKey === firstKey).toBe(false)
      expect((await db.order.findUniqueOrThrow({ where: { id: order.id } })).proofKey).toBe(firstKey)
      await attach(owner.page, locale, true)
      expect(await db.order.findUniqueOrThrow({ where: { id: order.id } })).toMatchObject({ status: 'AWAITING_CONFIRMATION', proofKey: secondKey, amountSen: 299900 })
      await owner.page.reload()
      await expect(owner.page.getByTestId('order-status')).toHaveText(c.awaiting)
      await privacy([firstKey, secondKey])
      await noDelivery(order.id)
    })

    test(locale + ': fresh admin verifies the net receipt, preserves rejected drafts and focuses success after row removal', async ({ page }, info) => {
      const owner = await fixture.owner()
      const plan = await fixture.plan()
      await fixture.founding(owner.actor.companyId, plan.code)
      const order = await fixture.create(owner.page, owner.actor.companyId, plan.id, locale)
      const proofKey = await upload(owner.page, locale)
      await attach(owner.page, locale)
      // Historical fulfillment also remains available after new sales close.
      await fixture.billing(false)
      const previewPath = '/api/admin/orders/' + order.id + '/payment-proof'
      const stale = await fixture.actor({ role: 'ADMIN' })
      await db.session.updateMany({ where: { userId: stale.actor!.userId }, data: { twoFactorVerifiedAt: new Date(Date.now() - 11 * 60_000) } })
      await stale.page.goto('/' + locale + '/admin/orders')
      const staleRow = stale.page.getByTestId('admin-order-' + order.id)
      await expect(staleRow).toBeVisible()
      const deniedPreview = await stale.page.request.get(previewPath)
      expect(deniedPreview.status()).toBe(403)
      expect((await deniedPreview.json()).code).toBe('FRESH_SESSION_REQUIRED')
      await staleRow.getByRole('button', { name: c.confirm, exact: true }).click()
      const staleDialog = stale.page.getByRole('dialog', { name: c.confirm, exact: true })
      await staleDialog.getByLabel(c.amount, { exact: true }).fill('1499.50')
      await staleDialog.getByLabel(c.note, { exact: true }).fill('SYNTHETIC stale-session note')
      await staleDialog.getByRole('button', { name: c.confirm, exact: true }).click()
      await expect(staleDialog.getByRole('alert')).toHaveText(c.fresh)
      await expect(staleDialog.getByLabel(c.amount, { exact: true })).toHaveValue('1499.50')
      await expect(staleDialog.getByLabel(c.note, { exact: true })).toHaveValue('SYNTHETIC stale-session note')
      await noDelivery(order.id)

      const privacy = await privatePayloadGuard(page)
      const automaticProofRequests: string[] = []
      page.on('request', (request) => { if (new URL(request.url()).pathname === previewPath) automaticProofRequests.push(request.method()) })
      await page.goto('/' + locale + '/admin/orders')
      const row = page.getByTestId('admin-order-' + order.id)
      await expect(row).toBeVisible()
      expect(automaticProofRequests).toEqual([])
      const preview = row.getByRole('link', { name: c.preview, exact: true })
      await expect(preview).toHaveAttribute('href', previewPath)
      const proof = await page.request.get(previewPath)
      expect(proof.status()).toBe(200)
      expect(proof.headers()['content-type']).toContain('image/png')
      expect(proof.headers()['cache-control']).toContain('no-store')
      expect(proof.headers()['cache-control']).toContain('private')
      expect(proof.headers()['x-content-type-options']).toBe('nosniff')
      expect(proof.headers().location).toBeUndefined()
      expect((await proof.body()).subarray(0, 8).equals(PNG.subarray(0, 8))).toBe(true)
      const trigger = row.getByRole('button', { name: c.confirm, exact: true })
      await trigger.click()
      const dialog = page.getByRole('dialog', { name: c.confirm, exact: true })
      const amount = dialog.getByLabel(c.amount, { exact: true })
      const note = dialog.getByLabel(c.note, { exact: true })
      await expect(amount).toHaveAttribute('inputmode', 'decimal')
      await expect(amount).toHaveValue('')
      await expect(note).toHaveValue('')
      const controls = dialog.locator('input,textarea,button:not([disabled])')
      await controls.last().focus()
      await page.keyboard.press('Tab')
      await expect(controls.first()).toBeFocused()
      await page.keyboard.press('Shift+Tab')
      await expect(controls.last()).toBeFocused()
      await page.keyboard.press('Escape')
      await expect(trigger).toBeFocused()
      await trigger.click()
      await note.fill('SYNTHETIC actual bank receipt checked')
      for (const invalid of ['1e3', '-1', '1,499.50', '1499.501']) {
        await amount.fill(invalid)
        await dialog.getByRole('button', { name: c.confirm, exact: true }).click()
        await expect(dialog.getByRole('alert')).toBeVisible()
        await expect(amount).toHaveValue(invalid)
        await expect(note).toHaveValue('SYNTHETIC actual bank receipt checked')
        await noDelivery(order.id)
      }
      await amount.fill('1499.49')
      await dialog.getByRole('button', { name: c.confirm, exact: true }).click()
      await expect(dialog.getByRole('alert')).toHaveText(c.mismatch)
      await expect(amount).toHaveValue('1499.49')
      await expect(note).toHaveValue('SYNTHETIC actual bank receipt checked')
      expect((await db.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe('AWAITING_CONFIRMATION')
      await noDelivery(order.id)
      await evidence(page, info, locale + '-confirmation-error')
      await amount.fill('1499.50')
      await guardedSubmit(page, dialog.locator('form'), dialog.getByRole('button', { name: c.confirm, exact: true }))
      await expect(dialog).not.toBeVisible()
      await expect(row).toHaveCount(0)
      const feedback = page.getByRole('status').filter({ hasText: c.confirmed })
      await expect(feedback).toBeVisible()
      await expect(feedback).toBeFocused()
      await evidence(page, info, locale + '-payment-confirmed')
      const paid = await db.order.findUniqueOrThrow({ where: { id: order.id } })
      expect(paid).toMatchObject({ status: 'PAID', amountSen: 149950, discountSen: 149950 })
      expect(paid.paidAt).not.toBeNull()
      const ledger = await db.creditLedger.findMany({ where: { refType: 'Order', refId: order.id } })
      expect(ledger).toHaveLength(1)
      expect(ledger[0]).toMatchObject({ reason: 'PLAN_GRANT', delta: 120 })
      expect(await db.subscription.count({ where: { orderId: order.id } })).toBe(1)
      expect(await db.auditLog.count({ where: { action: 'order.confirm', targetId: order.id } })).toBe(1)
      await privacy([proofKey])
      await owner.page.reload()
      await expect(owner.page.getByTestId('order-status')).toHaveText(c.paid)
      await expect(owner.page.getByTestId('payment-proof-form')).toHaveCount(0)
      await expect(owner.page.getByRole('button', { name: c.cancelOrder, exact: true })).toHaveCount(0)
    })
  }

  test('legacy and Stripe orders never expose bank-only mutation controls', async ({ page }) => {
    const owner = await fixture.owner()
    const plan = await fixture.plan('CREDIT_PACK')
    const order = await fixture.create(owner.page, owner.actor.companyId, plan.id, 'en')
    await expect(owner.page.getByRole('button', { name: COPY.en.cancelOrder, exact: true })).toBeVisible()
    const proofKey = await upload(owner.page, 'en')
    await attach(owner.page, 'en')
    const variants = [
      { paymentProvider: null, paymentMethod: 'BANK_TRANSFER' as const },
      { paymentProvider: 'STRIPE' as const, paymentMethod: null },
      { paymentProvider: 'STRIPE' as const, paymentMethod: 'BANK_TRANSFER' as const },
    ]
    for (const variant of variants) for (const status of ['PENDING', 'AWAITING_CONFIRMATION'] as const) {
      // Only synthetic unpaid records are changed to model historical channels.
      await db.order.update({ where: { id: order.id }, data: {
        ...variant, status, proofKey: status === 'PENDING' ? null : proofKey,
      } })
      await owner.page.goto('/en/e/billing/' + order.id)
      await expect(owner.page.getByTestId('order-summary')).toBeVisible()
      await expect(owner.page.getByTestId('payment-proof-form')).toHaveCount(0)
      await expect(owner.page.getByRole('button', { name: COPY.en.cancelOrder, exact: true })).toHaveCount(0)
      await page.goto('/en/admin/orders?status=ALL')
      const row = page.getByTestId('admin-order-' + order.id)
      await expect(row).toBeVisible()
      await expect(row.getByRole('button', { name: COPY.en.confirm, exact: true })).toHaveCount(0)
      await noDelivery(order.id)
    }
  })

  test('order and proof privacy survives stale OWNER pages, foreign companies and lower roles', async () => {
    const locale = 'en'
    const c = COPY.en
    const owner = await fixture.owner()
    const plan = await fixture.plan('CREDIT_PACK')
    const order = await fixture.create(owner.page, owner.actor.companyId, plan.id, locale)
    const path = '/en/e/billing/' + order.id
    await owner.page.getByRole('button', { name: c.cancelOrder, exact: true }).click()
    const dialog = owner.page.getByRole('dialog', { name: c.cancelOrder, exact: true })
    await db.companyMember.updateMany({ where: { userId: owner.actor.userId, companyId: owner.actor.companyId }, data: { role: 'RECRUITER' } })
    await dialog.getByRole('button', { name: c.confirmCancel, exact: true }).click()
    await expect(dialog.getByRole('alert')).toBeVisible()
    expect((await db.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe('PENDING')
    await noDelivery(order.id)
    await db.companyMember.updateMany({ where: { userId: owner.actor.userId, companyId: owner.actor.companyId }, data: { role: 'OWNER' } })
    await owner.page.goto(path)
    const proofKey = await upload(owner.page, locale)
    await attach(owner.page, locale)
    const previewPath = '/api/admin/orders/' + order.id + '/payment-proof'
    const ownerProof = await owner.page.request.get(previewPath)
    expect(ownerProof.status()).toBe(403)
    const actors = [
      await fixture.actor(),
      await fixture.actor({ role: 'STUDENT' }),
      await fixture.actor({ role: 'EMPLOYER', company: { memberRole: 'RECRUITER' } }),
      await fixture.actor({ role: 'EMPLOYER', company: { memberRole: 'ADMIN' } }),
      await fixture.actor({ role: 'EMPLOYER', company: { memberRole: 'OWNER' } }),
      await fixture.actor({ role: 'ADMIN', twoFactor: false }),
    ]
    for (const actor of actors) {
      // These actors cannot interact with billing. Buffer redirects as well,
      // because Chromium does not retain their document response bodies.
      const privacy = await privatePayloadGuard(actor.page, { bufferDocuments: true })
      const response = await actor.page.goto(path)
      expect(response?.status() ?? 500).toBeLessThan(500)
      await expect(actor.page.getByTestId('order-summary')).toHaveCount(0)
      await privacy([proofKey], [order.orderNo, plan.nameZh, plan.nameEn], false)
      const denied = await actor.page.request.get(previewPath)
      expect(denied.status()).toBe(actor.actor === null ? 401 : 403)
      expect(denied.headers()['content-type']).not.toContain('image/')
      expect(denied.headers().location).toBeUndefined()
    }
    expect((await db.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe('AWAITING_CONFIRMATION')
    await noDelivery(order.id)
  })
})
