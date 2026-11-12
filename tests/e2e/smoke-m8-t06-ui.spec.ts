/** Two language flows, real unlock/payment/invoice routes and tasks.
 * Requires an exclusive test DB, local storage and PDF fonts. */
import { test, expect } from '@playwright/test'
import { e2eDb as db } from './helpers/db'
import { attach, COPY, evidence, upload } from './helpers/billing-t02-ui'
import { copy, downloadAndCheck, invoiceState, runInvoiceChild } from './helpers/invoice-t05-ui'
import { cutoverState, CutoverUiFixture, insufficient } from './helpers/cutover-t06-ui'

test.use({ storageState: { cookies: [], origins: [] }, trace: 'off', screenshot: 'off', video: 'off' })
test.describe('T06 real billing cutover and existing financial rights', () => {
  test.setTimeout(360_000)
  let fixture: CutoverUiFixture
  test.beforeEach(async ({ page, browser, baseURL }) => {
    expect(test.info().config.workers, 'Use one worker and an exclusive local test database').toBe(1)
    fixture = new CutoverUiFixture(page, browser, baseURL)
    await fixture.init()
  })
  test.afterEach(async () => { if (fixture) await fixture.cleanup() })

  for (const locale of ['zh', 'en'] as const) {
    test(locale + ': pilot to paid guidance, sales-off settlement and the 149951-sen invoice', async ({}, info) => {
      const { owner, member, wallet, student } = await fixture.actorsWithEmptyWallet()
      const companyId = owner.actor.companyId
      const t = copy(locale).talentDetail
      await fixture.billing(false)
      const initial = await cutoverState(companyId)
      expect(initial.wallet).toEqual({ id: wallet.id, balance: 0 })
      expect(initial.ledger).toEqual([])
      expect(initial.studentBilling).toBe(false)
      for (const page of [owner.page, member.page]) {
        const dialog = await insufficient(page, locale, student.id)
        await expect(dialog.getByRole('alert')).toHaveText(t.unlockErrorInsufficientPilot)
        await expect(dialog.getByRole('link')).toHaveCount(0)
      }
      await evidence(owner.page, info, locale + '-pilot-empty-wallet', '[role="dialog"]')
      expect(await cutoverState(companyId)).toEqual(initial)

      await fixture.billing(true)
      const ownerDialog = await insufficient(owner.page, locale, student.id)
      await expect(ownerDialog.getByRole('alert').locator('p').first()).toHaveText(t.unlockErrorInsufficient)
      const purchase = ownerDialog.getByRole('link', { name: t.unlockPurchaseCredits, exact: true })
      await expect(purchase).toHaveAttribute('href', '/' + locale + '/e/billing')
      await evidence(owner.page, info, locale + '-paid-owner-empty-wallet', '[role="dialog"]')
      // Reopening must discard the previous error and purchase advice.
      await ownerDialog.getByRole('button', { name: t.unlockConfirmCancel, exact: true }).click()
      await owner.page.getByTestId('unlock-button').click()
      await expect(ownerDialog.getByRole('alert')).toHaveCount(0)
      await expect(ownerDialog.getByRole('link')).toHaveCount(0)
      await ownerDialog.getByRole('button', { name: t.unlockConfirmOk, exact: true }).click()
      await expect(purchase).toBeVisible()

      const memberDialog = await insufficient(member.page, locale, student.id)
      await expect(memberDialog.getByRole('alert').locator('p').first()).toHaveText(t.unlockErrorInsufficient)
      await expect(memberDialog).toContainText(t.unlockAskOwnerToPurchase)
      await expect(memberDialog.getByRole('link')).toHaveCount(0)
      await evidence(member.page, info, locale + '-paid-member-empty-wallet', '[role="dialog"]')
      expect(await cutoverState(companyId)).toEqual(initial)
      await purchase.focus()
      await purchase.press('Enter')
      await expect(owner.page).toHaveURL('/' + locale + '/e/billing')
      await expect(owner.page.getByTestId('billing-heading')).toBeVisible()
      expect(await cutoverState(companyId)).toEqual(initial)

      // Existing 23 credits originate in a real audited adjustment, not a balance write.
      await fixture.adjustCredits(companyId, 23)
      const existing = await cutoverState(companyId)
      expect(existing.ledger).toHaveLength(1)
      expect(existing.ledger[0]).toMatchObject({ reason: 'ADMIN_ADJUST', delta: 23, balanceAfter: 23 })
      await fixture.billing(false)
      expect(await cutoverState(companyId)).toEqual(existing)
      await fixture.billing(true)
      expect(await cutoverState(companyId)).toEqual(existing)
      const basePlan = await fixture.plan()
      const plan = await db.plan.update({ where: { id: basePlan.id }, data: { priceSen: 299901 } })
      await fixture.founding(companyId, plan.code)
      const order = await fixture.create(owner.page, companyId, plan.id, locale)
      expect(order).toMatchObject({ amountSen: 149951, discountSen: 149950, status: 'PENDING' })
      await upload(owner.page, locale)
      await attach(owner.page, locale)
      await fixture.billing(false)
      await fixture.confirmOrder(order.id, locale)
      const paid = await cutoverState(companyId)
      expect(paid.wallet).toEqual({ id: wallet.id, balance: 143 })
      expect(paid.ledger).toEqual(expect.arrayContaining(existing.ledger))
      expect(paid.ledger.filter(row => row.refType === 'Order' && row.refId === order.id)).toHaveLength(1)
      expect(paid.ledger.filter(row => row.reason === 'PILOT_GRANT')).toHaveLength(0)
      expect(paid.subscriptions).toBe(1)
      expect(paid.members).toBe(initial.members)
      expect(paid.studentBilling).toBe(false)

      await runInvoiceChild(fixture.marker, companyId, order.id, 'issue')
      const invoice = await db.invoice.findUniqueOrThrow({ where: { orderId: order.id } })
      expect(invoice.pdfStatus).toBe('QUEUED')
      expect(invoice.invoiceSnapshot).toMatchObject({ money: { payableSen: 149951, discountSen: 149950, listPriceSen: 299901 } })
      await runInvoiceChild(fixture.marker, companyId, order.id, 'process')
      const ready = await db.invoice.findUniqueOrThrow({ where: { id: invoice.id } })
      expect(ready.pdfStatus).toBe('READY')
      await owner.page.goto('/' + locale + '/e/billing/' + order.id)
      await expect(owner.page.getByTestId('order-status')).toHaveText(COPY[locale].paid)
      await expect(owner.page.getByTestId('order-amount')).toHaveText('MYR 1,499.51')
      const beforeDownload = await invoiceState(order.id)
      const pdf = await downloadAndCheck(owner.page, locale, invoice.id, invoice.invoiceNo, info, locale + '-cutover-invoice-149951')
      expect(pdf.hash).toBe(ready.pdfSha256)
      const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
      const task = pdfjs.getDocument({ data: new Uint8Array(pdf.bytes), useSystemFonts: false })
      try {
        const document = await task.promise
        let content = ''
        for (let number = 1; number <= document.numPages; number++) {
          content += (await (await document.getPage(number)).getTextContent()).items.map(item => 'str' in item ? item.str : '').join('')
        }
        const compact = content.replace(/\s+/g, '')
        expect(compact).toContain('1,499.51')
        expect(compact).toContain(invoice.invoiceNo)
        expect(compact).toContain(fixture.issuer.legalName.replace(/\s+/g, ''))
        expect(compact).toContain('SSTnotseparatelyitemised')
        expect(compact).not.toMatch(/TaxInvoice|0%|免税|\uFFFD/i)
      } finally { await task.destroy() }
      expect(await invoiceState(order.id)).toEqual(beforeDownload)
      expect(await cutoverState(companyId)).toEqual(paid)
      await evidence(owner.page, info, locale + '-sales-off-paid-invoice', '[data-testid="order-invoice"]')

      await fixture.billing(true)
      await owner.page.goto('/' + locale + '/e/billing/new?planId=' + plan.id)
      await expect(owner.page.getByTestId('quote-payable')).toHaveText('MYR 2,999.01')
      await expect(owner.page.getByTestId('quote-discount')).toHaveText('MYR 0.00')
      expect(await cutoverState(companyId)).toEqual(paid)
      expect(await invoiceState(order.id)).toEqual(beforeDownload)
      await info.attach(locale + '-cutover-financial-summary', {
        contentType: 'application/json', body: Buffer.from(JSON.stringify({
          companyId, walletId: wallet.id, initialBalance: 0, auditedExistingBalance: 23, paidBalance: 143,
          orderId: order.id, amountSen: order.amountSen, discountSen: order.discountSen,
          invoiceNo: invoice.invoiceNo, pdfSha256: pdf.hash, salesOffSettlement: true,
          subscriptionCount: paid.subscriptions, memberCount: paid.members, studentBilling: paid.studentBilling,
        }, null, 2)),
      })
    })
  }
})
