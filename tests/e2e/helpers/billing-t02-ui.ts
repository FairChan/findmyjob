import { randomUUID } from 'node:crypto'
import { loadEnvConfig } from '@next/env'
import { DeleteObjectsCommand, ListObjectVersionsCommand, S3Client } from '@aws-sdk/client-s3'
import { Prisma } from '@prisma/client'
import AxeBuilder from '@axe-core/playwright'
import { expect, type Browser, type BrowserContext, type Locator, type Page, type TestInfo } from '@playwright/test'
import en from '../../../messages/en.json'
import { e2eDb as db } from './db'
import { loginAs, type LoginOpts, type LoginResult } from './session'
import { checkA11y } from './a11y'

export const BANK_KEY = 'billing.bankTransfer'
export const BANK = {
  bankName: 'SYNTHETIC TEST BANK', accountName: 'SYNTHETIC TEST PAYEE',
  accountNumber: '0000000000', instructions: 'SYNTHETIC TEST ONLY. Do not transfer money.',
}
export const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==', 'base64')
export const COPY = {
  zh: {
    create: '创建银行转账订单', refreshQuote: '重新获取报价', quoteChanged: '报价已更新，请重新获取报价并确认。',
    bankName: '银行名称', accountName: '收款户名', accountNumber: '收款账号', instructions: '转账说明',
    saveBank: '保存收款信息', bankSaved: '收款信息已保存。',
    bankUnavailable: '银行转账暂不可用。收款信息尚未配置，请稍后再试。',
    bankHistory: '当前收款信息不可用。尚未付款请勿转账；已付款仍可提交付款凭证。',
    cancelOrder: '取消订单', confirmCancel: '确认取消', cancelled: '订单已取消。',
    proof: '付款凭证', upload: '上传凭证', submitProof: '提交核款',
    uploaded: '文件已上传，尚未提交核款。', attached: '凭证已提交，等待核对到账。', replaced: '凭证已更新，等待核对到账。',
    confirm: '确认到账', amount: '实际到账金额（MYR）', note: '核款备注', preview: '查看付款凭证',
    mismatch: '实际到账金额与订单应付金额不符。请重新核对，订单尚未确认。',
    confirmed: '已确认到账', fresh: '请重新登录并完成双重验证后再确认到账。',
    pending: '待付款', awaiting: '待核款', paid: '已确认到账', cancelledStatus: '已取消',
  },
  en: {
    create: 'Create bank transfer order', refreshQuote: 'Get a new quote', quoteChanged: 'The quote has changed. Get a new quote and confirm it again.',
    bankName: 'Bank name', accountName: 'Account name', accountNumber: 'Account number', instructions: 'Transfer instructions',
    saveBank: 'Save payment details', bankSaved: 'Payment details saved.',
    bankUnavailable: 'Bank transfers are unavailable. Payment details have not been configured. Please try again later.',
    bankHistory: 'Payment details are currently unavailable. Do not transfer funds if you have not paid. If you have already paid, you can still submit payment proof.',
    cancelOrder: 'Cancel order', confirmCancel: 'Confirm cancellation', cancelled: 'Order cancelled.',
    proof: 'Payment proof', upload: 'Upload payment proof', submitProof: 'Submit for verification',
    uploaded: 'File uploaded. Submit it for payment review.', attached: 'Payment proof submitted. Awaiting payment verification.', replaced: 'Payment proof updated. Awaiting payment verification.',
    confirm: 'Confirm payment received', amount: 'Amount received (MYR)', note: 'Verification note', preview: 'View payment proof',
    mismatch: 'The amount received does not match the amount due. Check the payment; this order has not been confirmed.',
    confirmed: 'Payment confirmed', fresh: 'Sign in again and complete two-factor authentication before confirming payment.',
    pending: 'Awaiting payment', awaiting: 'Awaiting verification', paid: 'Paid', cancelledStatus: 'Cancelled',
  },
} as const
export type Locale = keyof typeof COPY

type SettingSnapshot = { value: Prisma.JsonValue; updatedById: string | null; updatedAt: Date } | null

/** Uses only the guarded local test client; no integration/Vitest setup import. */
export class BillingUiFixture {
  readonly marker = 'M8T02_' + randomUUID().replaceAll('-', '').slice(0, 12).toUpperCase()
  readonly users: string[] = []
  readonly companies: string[] = []
  readonly plans: string[] = []
  readonly contexts: BrowserContext[] = []
  readonly snapshots = new Map<string, SettingSnapshot>()
  private touched = false
  private sequence = 0

  constructor(readonly adminPage: Page, readonly browser: Browser, readonly baseURL: string | undefined) {}

  async init() {
    for (const key of ['billing.enabled', BANK_KEY, 'billing.foundingOffer']) {
      this.snapshots.set(key, await db.systemSetting.findUnique({
        where: { key }, select: { value: true, updatedById: true, updatedAt: true },
      }))
    }
    const bank = this.snapshots.get(BANK_KEY)?.value
    const safeBank = bank == null || (typeof bank === 'object' && !Array.isArray(bank) && (
      Object.keys(bank).length === 0 || String(bank.bankName ?? '').startsWith('SYNTHETIC')
    ))
    // Boolean assertion prevents accidental disclosure of a non-synthetic baseline.
    expect(safeBank, 'Refusing to display or replace non-synthetic bank details in this local fixture').toBe(true)
    expect((await db.systemSetting.findUnique({ where: { key: 'billing.studentEnabled' } }))?.value ?? false).toBe(false)
    expect(typeof (this.snapshots.get('billing.enabled')?.value ?? false)).toBe('boolean')
    await this.login(this.adminPage, { role: 'ADMIN' })
    const response = await this.adminPage.goto('/en/admin/settings')
    expect(response?.status()).toBe(200)
    await expect(this.adminPage.getByRole('heading', { name: en.adminSettings.title, exact: true })).toBeVisible()
    await expect(this.adminPage.getByTestId('bank-transfer-settings')).toBeVisible()
    this.touched = true
    await this.saveBank(this.adminPage, 'en')
    await this.billing(true)
    await this.setting('billing.foundingOffer', {
      enabled: false, version: this.marker, rateBps: 5000,
      eligiblePlanCodes: [], eligibleCompanyIds: [], startsAt: null, endsAt: null,
    })
  }

  async login(page: Page, options: LoginOpts) {
    const actor = await loginAs(page, options)
    this.users.push(actor.userId)
    if (actor.companyId) {
      this.companies.push(actor.companyId)
      await db.company.update({ where: { id: actor.companyId }, data: { legalName: this.marker + ' Synthetic company' } })
    }
    return actor
  }

  async actor(options?: LoginOpts) {
    const context = await this.browser.newContext({ baseURL: this.baseURL, viewport: { width: 375, height: 900 } })
    this.contexts.push(context)
    const page = await context.newPage()
    const actor = options ? await this.login(page, options) : null
    return { page, actor }
  }

  async owner() {
    const { page, actor } = await this.actor({ role: 'EMPLOYER', company: { memberRole: 'OWNER', verificationStatus: 'UNSUBMITTED' } })
    if (!actor?.companyId) throw new Error('Synthetic owner fixture did not create a company')
    return { page, actor: actor as LoginResult & { companyId: string } }
  }

  async plan(kind: 'PLAN' | 'CREDIT_PACK' = 'PLAN') {
    this.sequence++
    const plan = await db.plan.create({ data: {
      code: this.marker + '_' + this.sequence, kind,
      nameZh: this.marker + ' 合成方案', nameEn: this.marker + ' Synthetic plan',
      priceSen: 299900, credits: kind === 'PLAN' ? 120 : 10,
      durationDays: kind === 'PLAN' ? 365 : null, jobPostLimit: kind === 'PLAN' ? 10 : null,
      seatLimit: kind === 'PLAN' ? 3 : null, invitationQuota: kind === 'PLAN' ? 200 : null,
      isActive: true, isPublic: true,
    } })
    this.plans.push(plan.id)
    return plan
  }

  async founding(companyId: string, planCode: string) {
    await db.company.update({ where: { id: companyId }, data: { isFoundingPartner: true } })
    await this.setting('billing.foundingOffer', {
      enabled: true, version: this.marker, rateBps: 5000,
      eligiblePlanCodes: [planCode], eligibleCompanyIds: [companyId],
      startsAt: new Date(Date.now() - 86_400_000).toISOString(), endsAt: new Date(Date.now() + 86_400_000).toISOString(),
    })
  }

  async setting(key: string, value: Prisma.InputJsonValue) {
    if (!this.snapshots.has(key)) throw new Error('Unowned setting key')
    await db.systemSetting.upsert({ where: { key }, create: { key, value }, update: { value } })
  }

  async billing(value: boolean) {
    await this.adminPage.goto('/en/admin/settings')
    const row = this.adminPage.getByRole('row').filter({ has: this.adminPage.getByRole('cell', { name: 'billing.enabled', exact: true }) })
    await row.getByRole('combobox').selectOption(String(value))
    await row.getByRole('button', { name: en.adminSettings.save, exact: true }).click()
    await this.adminPage.getByRole('dialog', { name: en.adminSettings.confirmTitle, exact: true })
      .getByRole('button', { name: en.adminSettings.confirmOk, exact: true }).click()
    await expect(row.getByText(en.adminSettings.saved, { exact: true })).toBeVisible()
    await expect.poll(async () => (await db.systemSetting.findUnique({ where: { key: 'billing.enabled' } }))?.value).toBe(value)
  }

  async saveBank(page: Page, locale: Locale) {
    const c = COPY[locale]
    await page.goto('/' + locale + '/admin/settings')
    const form = page.getByTestId('bank-transfer-settings')
    await expect(form).toBeVisible()
    await form.getByLabel(c.bankName, { exact: true }).fill(BANK.bankName)
    await form.getByLabel(c.accountName, { exact: true }).fill(BANK.accountName)
    await form.getByLabel(c.accountNumber, { exact: true }).fill(BANK.accountNumber)
    await form.getByLabel(c.instructions, { exact: true }).fill(BANK.instructions)
    await form.getByRole('button', { name: c.saveBank, exact: true }).click()
    await expect(form.getByRole('status')).toHaveText(c.bankSaved)
    await expect.poll(async () => (await db.systemSetting.findUnique({ where: { key: BANK_KEY } }))?.value).toEqual(BANK)
    return form
  }

  async create(page: Page, companyId: string, planId: string, locale: Locale) {
    const before = await db.order.count({ where: { companyId } })
    await page.goto('/' + locale + '/e/billing/new?planId=' + planId)
    await page.getByRole('button', { name: COPY[locale].create, exact: true }).click()
    await expect(page).toHaveURL(new RegExp('/' + locale + '/e/billing/[^/?]+$'))
    const id = new URL(page.url()).pathname.split('/').at(-1)!
    const order = await db.order.findUniqueOrThrow({ where: { id } })
    expect(order.companyId).toBe(companyId)
    expect(await db.order.count({ where: { companyId } })).toBe(before + 1)
    expect(order.status).toBe('PENDING')
    return order
  }

  async cleanup() {
    let restoreError: unknown
    try {
      if (this.touched) {
        // Normal application writes invalidate the running server's bank/billing cache.
        await this.saveBank(this.adminPage, 'en')
        await this.billing((this.snapshots.get('billing.enabled')?.value ?? false) as boolean)
      }
    } catch (error) {
      restoreError = error
    } finally {
      if (this.touched) for (const [key, row] of this.snapshots) {
        if (row) {
          const data = { ...row, value: row.value === null ? Prisma.JsonNull : row.value }
          await db.systemSetting.upsert({ where: { key }, create: { key, ...data }, update: data })
        } else await db.systemSetting.deleteMany({ where: { key } })
      }
      await Promise.all(this.contexts.map((context) => context.close()))
      if (!/^M8T02_[A-F0-9]{12}$/.test(this.marker)) throw new Error('Refusing unscoped cleanup')
      const uploads = await db.paymentProofUpload.findMany({
        where: { companyId: { in: this.companies } }, select: { storageKey: true, companyId: true },
      })
      let storageCleanupFailed = false
      try { await removeSyntheticProofs(uploads, this.companies) } catch {
        storageCleanupFailed = true
        restoreError ??= new Error('Synthetic proof cleanup failed; retained its ownership records for a later exact-key retry')
      }
      const settled = await db.creditLedger.findMany({
        where: { wallet: { companyId: { in: this.companies } } }, select: { wallet: { select: { companyId: true } } },
      })
      const retained = storageCleanupFailed ? this.companies : [...new Set(settled.map((row) => row.wallet.companyId))]
      const removable = this.companies.filter((id) => !retained.includes(id))
      await db.paymentProofUpload.deleteMany({ where: { companyId: { in: removable } } })
      await db.order.deleteMany({ where: { companyId: { in: removable } } })
      await db.company.deleteMany({ where: { id: { in: removable } } })
      await db.company.updateMany({ where: { id: { in: retained } }, data: { isActive: false } })
      await db.plan.deleteMany({ where: { id: { in: this.plans }, orders: { none: {} }, subscriptions: { none: {} } } })
      await db.plan.updateMany({ where: { id: { in: this.plans } }, data: { isActive: false, isPublic: false } })
      // Preserve financial/audit context; remove every credential and live session.
      await db.session.deleteMany({ where: { userId: { in: this.users } } })
      await db.account.deleteMany({ where: { userId: { in: this.users } } })
      await db.twoFactor.deleteMany({ where: { userId: { in: this.users } } })
      await db.user.updateMany({ where: { id: { in: this.users } }, data: { status: 'SUSPENDED' } })
      expect((await db.systemSetting.findUnique({ where: { key: 'billing.studentEnabled' } }))?.value ?? false).toBe(false)
    }
    if (restoreError) throw new Error('DB settings restored; fixture cleanup needs attention. Stop the owned server before another run.', { cause: restoreError })
  }
}

async function removeSyntheticProofs(uploads: { storageKey: string; companyId: string }[], companies: string[]) {
  if (uploads.length === 0) return
  const { combinedEnv: env } = loadEnvConfig(process.cwd())
  const endpoint = new URL(env.S3_ENDPOINT ?? '')
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(endpoint.hostname)) throw new Error('Proof cleanup requires local object storage')
  const client = new S3Client({
    endpoint: endpoint.toString(), region: env.S3_REGION ?? 'us-east-1', forcePathStyle: true,
    credentials: { accessKeyId: env.S3_ACCESS_KEY_ID ?? '', secretAccessKey: env.S3_SECRET_ACCESS_KEY ?? '' },
  })
  try {
    for (const upload of uploads) {
      const key = upload.storageKey
      if (!companies.includes(upload.companyId) || !key.startsWith('payment_proofs/' + upload.companyId + '/')) throw new Error('Unowned proof cleanup key')
      const versions = await client.send(new ListObjectVersionsCommand({ Bucket: env.S3_BUCKET, Prefix: key, MaxKeys: 100 }))
      if (versions.IsTruncated) throw new Error('Unexpected proof version count; bounded cleanup stopped')
      const objects = [...(versions.Versions ?? []), ...(versions.DeleteMarkers ?? [])]
        .filter((item) => item.Key === key).map((item) => ({ Key: key, VersionId: item.VersionId }))
      if (objects.length) {
        const result = await client.send(new DeleteObjectsCommand({ Bucket: env.S3_BUCKET, Delete: { Objects: objects, Quiet: true } }))
        if (result.Errors?.length) throw new Error('Synthetic proof cleanup failed')
      }
    }
  } finally { client.destroy() }
}

export async function evidence(page: Page, info: TestInfo, label: string, scope?: string) {
  for (const width of [375, 1280]) {
    await page.setViewportSize({ width, height: 900 })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2)).toBe(true)
    if (scope) {
      const result = await new AxeBuilder({ page }).include(scope).analyze()
      expect(result.violations.filter((item) => item.impact === 'serious' || item.impact === 'critical')).toHaveLength(0)
    } else await checkA11y(page)
    const path = info.outputPath(label + '-' + width + '.png')
    await page.screenshot({ path, fullPage: true })
    await info.attach(label + '-' + width, { path, contentType: 'image/png' })
  }
  await page.setViewportSize({ width: 375, height: 900 })
}

export async function noDelivery(orderId: string) {
  expect(await db.creditLedger.count({ where: { refType: 'Order', refId: orderId } })).toBe(0)
  expect(await db.subscription.count({ where: { orderId } })).toBe(0)
}

export async function upload(page: Page, locale: Locale, name = 'synthetic-proof.png') {
  const form = page.getByTestId('payment-proof-form')
  await form.getByLabel(COPY[locale].proof, { exact: true }).setInputFiles({ name, mimeType: 'image/png', buffer: PNG })
  const responsePromise = page.waitForResponse((response) => new URL(response.url()).pathname === '/api/uploads/PAYMENT_PROOF' && response.request().method() === 'POST')
  await form.getByRole('button', { name: COPY[locale].upload, exact: true }).click()
  const response = await responsePromise
  expect(response.status()).toBe(200)
  const result = await response.json() as { ok: boolean; key: string }
  expect(result.ok).toBe(true)
  await expect(form.getByText(COPY[locale].uploaded, { exact: true })).toBeVisible()
  return result.key
}

export async function attach(page: Page, locale: Locale, replacement = false) {
  await page.getByTestId('payment-proof-form').getByRole('button', { name: COPY[locale].submitProof, exact: true }).click()
  const feedback = page.getByRole('status').filter({ hasText: replacement ? COPY[locale].replaced : COPY[locale].attached })
  await expect(feedback).toBeVisible()
  await expect(feedback).toBeFocused()
  // The success announcement precedes router.refresh(); finish reading its RSC
  // response before another navigation can discard the browser response body.
  await page.waitForLoadState('networkidle')
}

export async function abortAction(page: Page, submit: () => Promise<void>) {
  const pathname = new URL(page.url()).pathname
  let calls = 0
  const match = (url: URL) => url.pathname === pathname
  await page.route(match, async (route) => {
    if (route.request().method() === 'POST' && route.request().headers()['next-action']) {
      calls++
      await route.abort('failed')
    } else await route.fallback()
  })
  try { await submit() } finally { await page.unroute(match) }
  expect(calls).toBe(1)
}

export async function guardedSubmit(page: Page, form: Locator, button: Locator) {
  const pathname = new URL(page.url()).pathname
  let calls = 0
  let release!: () => void
  const gate = new Promise<void>((resolve) => { release = resolve })
  const match = (url: URL) => url.pathname === pathname
  const response = page.waitForResponse((result) =>
    new URL(result.url()).pathname === pathname && result.request().method() === 'POST' &&
    !!result.request().headers()['next-action'],
  ).catch(() => null)
  await page.route(match, async (route) => {
    if (route.request().method() === 'POST' && route.request().headers()['next-action']) {
      calls++
      await gate
    }
    await route.fallback()
  })
  try {
    await button.click()
    await expect(button).toBeDisabled()
    await form.evaluate((element) => element.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))
    await expect.poll(() => calls).toBe(1)
  } finally {
    release()
    try {
      if (calls > 0) {
        expect(await response).not.toBeNull()
        // Include any queued action after the first response before asserting count.
        await page.waitForLoadState('networkidle')
        expect(calls).toBe(1)
      }
    } finally { await page.unroute(match) }
  }
}

/** Only page HTML/RSC is collected in memory, never upload or binary proof responses. */
export async function privatePayloadGuard(page: Page, { bufferDocuments = false }: { bufferDocuments?: boolean } = {}) {
  const payloads: Promise<string>[] = []
  const readFailures: string[] = []
  const suspiciousUrls: string[] = []
  const match = (url: URL) => /\/(?:e\/billing|admin\/orders)(?:\/|$)/.test(url.pathname)
  // Buffer the real response before delivery. Chromium may discard an action
  // body during router.refresh(), so a later CDP read cannot prove its privacy.
  await page.route(match, async (route) => {
    // Preserve the browser's streaming document load and hydration timing.
    if (route.request().isNavigationRequest() && !bufferDocuments) { await route.continue(); return }
    const response = await route.fetch({ maxRedirects: 0 })
    const body = await response.body()
    if (/text\/html|text\/x-component/.test(response.headers()['content-type'] ?? '')) {
      if (payloads.length >= 80) throw new Error('Unexpected page response count')
      payloads.push(Promise.resolve(body.toString('utf8')))
    }
    await route.fulfill({ response, body })
    await response.dispose()
  })
  page.on('response', (response) => {
    if (bufferDocuments || !response.request().isNavigationRequest() || !match(new URL(response.url()))
      || !/text\/html/.test(response.headers()['content-type'] ?? '')) return
    if (payloads.length >= 80) throw new Error('Unexpected page response count')
    payloads.push(response.text().catch(() => { readFailures.push(new URL(response.url()).pathname); return '' }))
  })
  page.on('request', (request) => {
    if (/payment_proofs|X-Amz-|X-Goog-/i.test(request.url())) suspiciousUrls.push(request.url())
  })
  return async (proofKeys: string[], otherSecrets: string[] = [], requirePayload = true) => {
    await page.waitForLoadState('networkidle')
    const bodies = [...await Promise.all(payloads), await page.content()]
    expect(readFailures, 'Every observed document body must be inspected').toEqual([])
    if (requirePayload) expect(payloads.length).toBeGreaterThan(0)
    expect(bodies.every((body) => [...proofKeys, ...otherSecrets].every((secret) => !body.includes(secret)))).toBe(true)
    expect(bodies.every((body) => !/X-Amz-(?:Signature|Credential)|X-Goog-Signature/i.test(body))).toBe(true)
    expect(suspiciousUrls.length).toBe(0)
    await page.unroute(match)
  }
}
