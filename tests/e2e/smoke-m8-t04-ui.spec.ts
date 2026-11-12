/** T04 browser checks. Shared guarded local fixture; real actions.
 * No fabricated subscription/payment, no provider traffic, no new API bypass.
 * Requires the existing FREE plan to have a finite seatLimit between 1 and 10. */
import { test, expect } from '@playwright/test'
import { createHash, randomUUID } from 'node:crypto'
import en from '../../messages/en.json'
import zh from '../../messages/zh.json'
import { e2eDb as db } from './helpers/db'
import { BillingUiFixture, evidence as visual } from './helpers/billing-t02-ui'

test.use({ storageState: { cookies: [], origins: [] }, trace: 'off', screenshot: 'off', video: 'off' })
test.describe('T04 real seat limits and owner guidance', () => {
  test.setTimeout(240_000)
  let fixture: BillingUiFixture
  let createdFreeId: string | null = null
  test.beforeEach(async ({ page, browser, baseURL }) => {
    createdFreeId = null
    expect(test.info().config.workers).toBe(1)
    fixture = new BillingUiFixture(page, browser, baseURL)
    await fixture.init()
    if (!await db.plan.findUnique({ where: { code: 'FREE' } })) {
      const free = await db.plan.create({ data: {
        code: 'FREE', kind: 'PLAN', nameZh: '合成免费方案', nameEn: 'Synthetic free plan',
        priceSen: 0, credits: 0, durationDays: null, jobPostLimit: 2, seatLimit: 3, invitationQuota: 20,
      } })
      createdFreeId = free.id
    }
  })
  test.afterEach(async () => {
    try { if (fixture) await fixture.cleanup() }
    finally { if (createdFreeId) await db.plan.delete({ where: { id: createdFreeId } }) }
  })

  for (const locale of ['zh', 'en'] as const) {
    test(locale + ': retains existing over-limit members and refuses new invitations and old-token acceptance', async ({}, info) => {
      const t = locale === 'zh' ? zh : en
      const free = await db.plan.findUniqueOrThrow({ where: { code: 'FREE' } })
      expect(free.isActive).toBe(true)
      expect(Number.isInteger(free.seatLimit) && free.seatLimit! >= 1 && free.seatLimit! <= 10, 'Use a finite synthetic FREE baseline without overwriting the configured plan').toBe(true)
      const limit = free.seatLimit!
      const owner = await fixture.owner()
      let memberPage = owner.page
      // Existing resources may legitimately exceed a newly reduced allowance.
      // Synthetic memberships establish that retained state, never fake payment.
      for (let index = 0; index < limit; index++) {
        const other = await fixture.actor({ role: 'EMPLOYER' })
        if (!other.actor) throw new Error('Missing synthetic member')
        await db.companyMember.create({ data: { companyId: owner.actor.companyId, userId: other.actor.userId, role: 'RECRUITER' } })
        memberPage = other.page
      }
      const count = limit + 1
      const invitee = await fixture.actor({ role: 'EMPLOYER' })
      if (!invitee.actor) throw new Error('Missing synthetic invitee')
      const token = randomUUID()
      const old = await db.companyInvite.create({ data: {
        companyId: owner.actor.companyId, createdById: owner.actor.userId, email: invitee.actor.email, role: 'RECRUITER',
        tokenHash: createHash('sha256').update(token).digest('hex'), expiresAt: new Date(Date.now() + 86_400_000),
      } })
      const beforeInvites = await db.companyInvite.count({ where: { companyId: owner.actor.companyId } })
      await owner.page.goto('/' + locale + '/e/team')
      await expect(owner.page.getByTestId('entitlement-usage')).toContainText(t.entitlements.finiteUsage.replace('{used}', String(count)).replace('{limit}', String(limit)))
      await expect(owner.page.getByTestId('entitlement-usage')).toContainText(t.entitlements.reservedSeats.replace('{reserved}', '1'))
      const email = owner.page.locator('input[type="email"]')
      const address = 'synthetic-' + randomUUID() + '@example.test'
      await email.fill(address)
      await owner.page.getByRole('button', { name: t.team.inviteSubmit, exact: true }).click()
      const notice = owner.page.getByTestId('entitlement-limit-notice')
      await expect(notice).toContainText(t.entitlements.seatsLimit)
      await expect(notice.getByRole('link', { name: t.entitlements.viewPlans, exact: true })).toHaveAttribute('href', '/' + locale + '/pricing')
      await expect(email).toHaveValue(address)
      expect(await db.companyInvite.count({ where: { companyId: owner.actor.companyId } })).toBe(beforeInvites)
      await visual(owner.page, info, locale + '-team-seat-limit', '[data-testid="entitlement-limit-notice"]')

      await memberPage.goto('/' + locale + '/e/team')
      await expect(memberPage.getByTestId('entitlement-usage')).toContainText(t.entitlements.seatsRetained)
      await expect(memberPage.getByTestId('entitlement-usage').locator('a[href*="/pricing"],a[href*="/e/billing"]')).toHaveCount(0)
      await invitee.page.goto('/' + locale + '/e/team/accept?token=' + encodeURIComponent(token))
      await invitee.page.getByRole('button', { name: t.teamAccept.acceptButton, exact: true }).click()
      await expect(invitee.page.getByTestId('entitlement-limit-notice')).toContainText(t.entitlements.contactOwner)
      await expect(invitee.page.getByTestId('entitlement-limit-notice').locator('a[href*="/pricing"],a[href*="/e/billing"]')).toHaveCount(0)
      expect((await db.companyInvite.findUniqueOrThrow({ where: { id: old.id } })).acceptedAt).toBeNull()
      expect(await db.companyMember.count({ where: { companyId: owner.actor.companyId } })).toBe(count)
      expect(await db.companyMember.count({ where: { userId: invitee.actor.userId } })).toBe(0)
      await visual(invitee.page, info, locale + '-invitee-seat-limit', '[data-testid="entitlement-limit-notice"]')
    })
  }
})
