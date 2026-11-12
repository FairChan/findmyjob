import { expect, type Page } from '@playwright/test'
import { e2eDb as db } from './db'
import { COPY, type Locale } from './billing-t02-ui'
import { copy, InvoiceUiFixture } from './invoice-t05-ui'

/** Synthetic empty-wallet setup only. Positive credits use the real admin UI. */
export class CutoverUiFixture extends InvoiceUiFixture {
  private readonly studentIds: string[] = []

  async actorsWithEmptyWallet() {
    const enabled = (await db.systemSetting.findUnique({ where: { key: 'unlock.enabled' } }))?.value ?? true
    const cost = (await db.systemSetting.findUnique({ where: { key: 'unlock.costCredits' } }))?.value ?? 1
    const limit = (await db.systemSetting.findUnique({ where: { key: 'limits.unlocksPerDay' } }))?.value ?? 50
    expect(enabled).toBe(true)
    expect(typeof cost === 'number' && Number.isSafeInteger(cost) && cost > 0).toBe(true)
    expect(typeof limit === 'number' && Number.isSafeInteger(limit) && limit > 0).toBe(true)
    const owner = await this.owner()
    // Test identity/visibility setup is not evidence of the company approval flow.
    await db.company.update({ where: { id: owner.actor.companyId }, data: {
      verificationStatus: 'VERIFIED', verifiedAt: new Date(), address: '合成测试吉隆坡公司地址十八号',
    } })
    const wallet = await db.creditWallet.create({ data: { companyId: owner.actor.companyId, balance: 0 } })
    const member = await this.actor({ role: 'EMPLOYER' })
    if (!member.actor) throw new Error('Synthetic recruiter missing')
    await db.companyMember.create({ data: { userId: member.actor.userId, companyId: owner.actor.companyId, role: 'RECRUITER' } })
    const studentUser = await db.user.create({ data: {
      name: this.marker + ' 合成候选人', email: this.marker.toLowerCase() + '@example.test',
      role: 'STUDENT', status: 'ACTIVE', emailVerified: true,
    } })
    this.users.push(studentUser.id)
    const student = await db.studentProfile.create({ data: {
      userId: studentUser.id, fullName: this.marker + ' 合成候选人', visibility: 'PUBLIC', completeness: 100,
      schoolVerifiedAt: new Date(), skills: ['Synthetic testing'], intents: [], preferredStates: [], preferredIndustries: [],
    } })
    this.studentIds.push(student.id)
    return { owner, member, wallet, student }
  }

  async adjustCredits(companyId: string, delta: number) {
    if (!this.companies.includes(companyId)) throw new Error('Unowned adjustment')
    await this.login(this.adminPage, { role: 'ADMIN' })
    const t = copy('en').adminCompanyManage
    await this.adminPage.goto('/en/admin/companies/' + companyId)
    const form = this.adminPage.locator('form').filter({ has: this.adminPage.getByLabel(t.creditsDeltaLabel, { exact: true }) })
    await form.getByLabel(t.creditsDeltaLabel, { exact: true }).fill(String(delta))
    await form.getByLabel(t.creditsNoteLabel, { exact: true }).fill('SYNTHETIC T06 existing balance rehearsal')
    await form.getByRole('button', { name: t.creditsSubmit, exact: true }).click()
    await expect(form.getByText(t.successCredits.replace('{balance}', '23'), { exact: true })).toBeVisible()
    expect((await db.creditWallet.findUniqueOrThrow({ where: { companyId } })).balance).toBe(23)
  }

  async confirmOrder(orderId: string, locale: Locale) {
    const t = COPY[locale]
    await this.login(this.adminPage, { role: 'ADMIN' })
    await this.adminPage.goto('/' + locale + '/admin/orders')
    const row = this.adminPage.getByTestId('admin-order-' + orderId)
    await row.getByRole('button', { name: t.confirm, exact: true }).click()
    const dialog = this.adminPage.getByRole('dialog', { name: t.confirm, exact: true })
    await dialog.getByLabel(t.amount, { exact: true }).fill('1499.51')
    await dialog.getByLabel(t.note, { exact: true }).fill('SYNTHETIC T06 bank receipt checked')
    await dialog.getByRole('button', { name: t.confirm, exact: true }).click()
    await expect(dialog).not.toBeVisible()
    await expect(row).toHaveCount(0)
    await expect(this.adminPage.getByRole('status').filter({ hasText: t.confirmed })).toBeVisible()
    expect((await db.order.findUniqueOrThrow({ where: { id: orderId } })).status).toBe('PAID')
  }

  async cleanup() {
    try {
      await db.studentProfile.updateMany({ where: { id: { in: this.studentIds }, userId: { in: this.users } }, data: { visibility: 'HIDDEN' } })
    } finally { await super.cleanup() }
  }
}

export async function insufficient(page: Page, locale: Locale, studentId: string) {
  const t = copy(locale).talentDetail
  await page.goto('/' + locale + '/e/talent/' + studentId)
  const button = page.getByTestId('unlock-button')
  await expect(button).toBeVisible()
  await button.focus()
  await button.press('Enter')
  const dialog = page.getByRole('dialog', { name: t.unlockConfirmTitle, exact: true })
  await expect(dialog.getByRole('alert')).toHaveCount(0)
  const confirm = dialog.getByRole('button', { name: t.unlockConfirmOk, exact: true })
  await confirm.focus()
  await confirm.press('Enter')
  await expect(dialog.getByRole('alert')).toBeVisible()
  return dialog
}

export async function cutoverState(companyId: string) {
  const wallet = await db.creditWallet.findUniqueOrThrow({ where: { companyId } })
  return {
    wallet: { id: wallet.id, balance: wallet.balance },
    ledger: await db.creditLedger.findMany({ where: { walletId: wallet.id }, orderBy: { id: 'asc' } }),
    unlocks: await db.talentUnlock.count({ where: { companyId } }),
    orders: await db.order.count({ where: { companyId } }),
    subscriptions: await db.subscription.count({ where: { companyId } }),
    members: await db.companyMember.count({ where: { companyId } }),
    studentBilling: (await db.systemSetting.findUnique({ where: { key: 'billing.studentEnabled' } }))?.value ?? false,
  }
}
