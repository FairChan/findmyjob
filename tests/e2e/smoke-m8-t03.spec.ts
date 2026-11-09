/**
 * Local-only T03 browser boundary. Requires agreed UI/action/schema baselines.
 * Creates real STRIPE/PENDING orders but never runs a real start/Stripe request:
 * explicit checkout failures are aborted before the server action executes.
 * The successful action/link branch is covered separately with jsdom mocks.
 */
import { test, expect } from '@playwright/test'
import { e2eDb as db } from './helpers/db'
import { BillingUiFixture, COPY, abortAction, evidence, noDelivery, privatePayloadGuard } from './helpers/billing-t02-ui'

const STRIPE = {
  zh: { choice: '银行卡或 FPX（Stripe）', start: '继续安全结账' },
  en: { choice: 'Card or FPX (Stripe)', start: 'Continue to secure checkout' },
} as const
test.use({ storageState: { cookies: [], origins: [] }, trace: 'off', screenshot: 'off', video: 'off' })

test.describe('M8-T03 local Stripe order boundaries', () => {
  test.setTimeout(240_000)
  let fixture: BillingUiFixture
  test.beforeEach(async ({ page, browser, baseURL }) => {
    expect(test.info().config.workers, 'Run shared local billing fixtures with --workers=1').toBe(1)
    fixture = new BillingUiFixture(page, browser, baseURL)
    await fixture.init()
  })
  test.afterEach(async () => { if (fixture) await fixture.cleanup() })

  for (const locale of ['zh', 'en'] as const) {
    test(locale + ': Stripe selection creates only a pending local order; forged return and failed checkout remain recoverable', async ({}, info) => {
      const owner = await fixture.owner()
      const plan = await fixture.plan('CREDIT_PACK')
      const c = COPY[locale]
      const privacy = await privatePayloadGuard(owner.page)
      let externalNavigation = 0
      owner.page.on('request', (request) => {
        if (request.isNavigationRequest() && new URL(request.url()).hostname === 'checkout.stripe.com') externalNavigation++
      })
      await owner.page.goto('/' + locale + '/e/billing/new?planId=' + plan.id)
      const quote = owner.page.getByTestId('billing-quote')
      await expect(quote.getByRole('radio', { name: STRIPE[locale].choice, exact: true })).toBeVisible()
      await quote.getByRole('radio', { name: STRIPE[locale].choice, exact: true }).check()
      await expect(quote.getByRole('radio', { name: STRIPE[locale].choice, exact: true })).toBeChecked()
      expect(await db.order.count({ where: { companyId: owner.actor.companyId } })).toBe(0)
      await evidence(owner.page, info, locale + '-stripe-choice')
      await quote.getByRole('button', { name: c.create, exact: true }).click()
      await expect(owner.page).toHaveURL(new RegExp('/' + locale + '/e/billing/[^/?]+$'))
      const orderId = new URL(owner.page.url()).pathname.split('/').at(-1)!
      const order = await db.order.findUniqueOrThrow({ where: { id: orderId } })
      expect(order).toMatchObject({ companyId: owner.actor.companyId, paymentProvider: 'STRIPE', paymentMethod: null, status: 'PENDING' })
      expect(order.externalRef).toBeNull()
      const beforeWallet = await db.creditWallet.findUnique({ where: { companyId: owner.actor.companyId }, select: { balance: true } })
      const path = '/' + locale + '/e/billing/' + order.id
      for (const query of ['?success=true&payment_status=paid', '?cancelled=true', '?session_id=cs_test_untrusted_query']) {
        await owner.page.goto(path + query)
        await expect(owner.page.getByTestId('order-status')).toHaveText(c.pending)
        await expect(owner.page.getByTestId('fpx-receipt')).toHaveCount(0)
        await expect(owner.page.getByTestId('payment-proof-form')).toHaveCount(0)
        await expect(owner.page.getByRole('button', { name: c.cancelOrder, exact: true })).toHaveCount(0)
        await expect(owner.page.getByTestId('stripe-checkout-form')).toBeVisible()
        expect((await db.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe('PENDING')
        await noDelivery(order.id)
      }
      const checkout = owner.page.getByTestId('stripe-checkout-form')
      for (let retry = 0; retry < 2; retry++) {
        await abortAction(owner.page, async () => {
          await checkout.getByRole('button', { name: STRIPE[locale].start, exact: true }).click()
          await expect(checkout.getByRole('alert')).toBeVisible()
        })
        await expect(checkout.getByRole('button', { name: STRIPE[locale].start, exact: true })).toBeEnabled()
        await expect(checkout.locator('a[href^="https://checkout.stripe.com"]')).toHaveCount(0)
      }
      await evidence(owner.page, info, locale + '-stripe-start-retry')
      expect(externalNavigation).toBe(0)
      expect(await db.order.count({ where: { companyId: owner.actor.companyId } })).toBe(1)
      expect((await db.order.findUniqueOrThrow({ where: { id: order.id } })).externalRef).toBeNull()
      expect(await db.creditWallet.findUnique({ where: { companyId: owner.actor.companyId }, select: { balance: true } })).toEqual(beforeWallet)
      expect(await db.auditLog.count({ where: { targetId: order.id, action: 'order.confirm' } })).toBe(0)
      await noDelivery(order.id)
      await privacy([], [owner.actor.companyId])
    })
  }

  test('real OWNER reads deny anonymous/lower-role/foreign users and never grant Session query access', async () => {
    const owner = await fixture.owner()
    const plan = await fixture.plan('CREDIT_PACK')
    await owner.page.goto('/en/e/billing/new?planId=' + plan.id)
    await owner.page.getByRole('radio', { name: STRIPE.en.choice, exact: true }).check()
    await owner.page.getByRole('button', { name: COPY.en.create, exact: true }).click()
    await expect(owner.page).toHaveURL(/\/en\/e\/billing\/[^/?]+$/)
    const orderId = new URL(owner.page.url()).pathname.split('/').at(-1)!
    const order = await db.order.findUniqueOrThrow({ where: { id: orderId } })
    const path = '/en/e/billing/' + order.id + '?success=true&session_id=cs_test_query_only'
    const actors = [
      await fixture.actor(),
      await fixture.actor({ role: 'STUDENT' }),
      await fixture.actor({ role: 'EMPLOYER', company: { memberRole: 'RECRUITER' } }),
      await fixture.actor({ role: 'EMPLOYER', company: { memberRole: 'ADMIN' } }),
      await fixture.actor({ role: 'EMPLOYER', company: { memberRole: 'OWNER' } }),
    ]
    for (const actor of actors) {
      const privacy = await privatePayloadGuard(actor.page, { bufferDocuments: true })
      const response = await actor.page.goto(path)
      expect(response?.status() ?? 500).toBeLessThan(500)
      await expect(actor.page.getByTestId('order-summary')).toHaveCount(0)
      await expect(actor.page.getByTestId('stripe-checkout-form')).toHaveCount(0)
      await expect(actor.page.getByTestId('fpx-receipt')).toHaveCount(0)
      await privacy([], [order.orderNo, plan.nameZh, plan.nameEn], false)
    }
    await db.companyMember.updateMany({ where: { userId: owner.actor.userId, companyId: owner.actor.companyId }, data: { role: 'RECRUITER' } })
    try {
      const privacy = await privatePayloadGuard(owner.page, { bufferDocuments: true })
      await owner.page.goto(path)
      await expect(owner.page.getByTestId('order-summary')).toHaveCount(0)
      await expect(owner.page.getByTestId('stripe-checkout-form')).toHaveCount(0)
      await privacy([], [order.orderNo], false)
    } finally {
      await db.companyMember.updateMany({ where: { userId: owner.actor.userId, companyId: owner.actor.companyId }, data: { role: 'OWNER' } })
    }
    expect((await db.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe('PENDING')
    await noDelivery(order.id)
  })
})
