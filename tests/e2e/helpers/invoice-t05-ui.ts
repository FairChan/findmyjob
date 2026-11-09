import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'
import { readFile, stat } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { Prisma } from '@prisma/client'
import { expect, type Browser, type Page, type TestInfo } from '@playwright/test'
import { PDFDocument } from 'pdf-lib'
import en from '../../../messages/en.json'
import zh from '../../../messages/zh.json'
import { e2eDb as db } from './db'
import { validateTestDbUrl } from '../../lib/validate-test-db-url'
import { EMPTY_INVOICE_ISSUER, invoiceIssuerSettingsSchema } from '../../../src/server/lib/invoice-settings'
import { BillingUiFixture, COPY, attach, upload, type Locale } from './billing-t02-ui'

export const ISSUER_KEY = 'billing.invoiceIssuer'
type Issuer = { schemaVersion: 1; version: string; legalName: string; address: string; registrationNo: string | null }
type IssuerSnapshot = { value: Prisma.JsonValue; updatedById: string | null; updatedAt: Date } | null
export function copy(locale: Locale) { return locale === 'zh' ? zh : en }
function issuerValue(value: Prisma.JsonValue | undefined): Issuer | null {
  if (value == null || typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === 0) return null
  const parsed = invoiceIssuerSettingsSchema.safeParse(value)
  if (parsed.success && ['version', 'legalName', 'address', 'registrationNo'].every(field => !String(parsed.data[field as keyof Issuer] ?? '').trim())) return null
  if (typeof value !== 'object' || Array.isArray(value)
    || value.schemaVersion !== 1 || typeof value.version !== 'string' || typeof value.legalName !== 'string'
    || typeof value.address !== 'string' || value.registrationNo !== null && typeof value.registrationNo !== 'string'
    || !value.legalName.startsWith('SYNTHETIC ')) throw new Error('Issuer fixture requires an empty or synthetic baseline')
  return value as Issuer
}

export class InvoiceUiFixture extends BillingUiFixture {
  private issuerSnapshot: IssuerSnapshot = null
  private issuerTouched = false
  readonly issuer: Issuer = {
    schemaVersion: 1, version: this.marker, legalName: 'SYNTHETIC 合成开票主体 ' + this.marker,
    address: 'SYNTHETIC 吉隆坡合成开票地址一号\nSynthetic Kuala Lumpur', registrationNo: null,
  }
  constructor(page: Page, browser: Browser, baseURL: string | undefined) { super(page, browser, baseURL) }
  async init() {
    this.issuerSnapshot = await db.systemSetting.findUnique({ where: { key: ISSUER_KEY }, select: { value: true, updatedById: true, updatedAt: true } })
    issuerValue(this.issuerSnapshot?.value)
    await super.init()
    this.issuerTouched = true
    await this.saveIssuer(this.issuer)
  }
  async saveIssuer(value: Issuer | null) {
    const t = en.adminInvoiceIssuer
    await this.adminPage.goto('/en/admin/settings')
    const form = this.adminPage.getByTestId('invoice-issuer-settings')
    await expect(form).toBeVisible()
    for (const field of ['legalName', 'address', 'registrationNo', 'version'] as const) {
      await form.getByLabel(t[field], { exact: true }).fill(value?.[field] ?? '')
    }
    await form.getByRole('button', { name: t.saveIssuer, exact: true }).click()
    await expect(form.getByRole('status')).toHaveText(t.issuerSaved)
    const stored = (await db.systemSetting.findUnique({ where: { key: ISSUER_KEY } }))?.value
    if (value) expect(stored).toEqual(value)
    else expect(stored).toEqual(EMPTY_INVOICE_ISSUER)
  }
  async cleanup() {
    let failure = false
    try {
      if (this.issuerTouched) await this.saveIssuer(issuerValue(this.issuerSnapshot?.value))
    } catch { failure = true }
    finally {
      try {
        if (this.issuerTouched) {
          if (this.issuerSnapshot) {
            const data = { ...this.issuerSnapshot, value: this.issuerSnapshot.value === null ? Prisma.JsonNull : this.issuerSnapshot.value }
            await db.systemSetting.upsert({ where: { key: ISSUER_KEY }, create: { key: ISSUER_KEY, ...data }, update: data })
          } else await db.systemSetting.deleteMany({ where: { key: ISSUER_KEY } })
        }
      } finally { await super.cleanup() }
    }
    if (failure) throw new Error('Issuer DB restored; stop owned server before another run because cache restoration failed')
  }
  async paidOrder(locale: Locale) {
    const owner = await this.owner()
    const buyer = this.marker + ' 合成测试企业'
    await db.company.update({ where: { id: owner.actor.companyId }, data: { legalName: buyer, address: '合成测试吉隆坡公司地址十八号' } })
    const plan = await this.plan()
    await this.founding(owner.actor.companyId, plan.code)
    const order = await this.create(owner.page, owner.actor.companyId, plan.id, locale)
    await upload(owner.page, locale)
    await attach(owner.page, locale)
    await this.adminPage.goto('/' + locale + '/admin/orders')
    const t = COPY[locale]
    const row = this.adminPage.getByTestId('admin-order-' + order.id)
    await expect(row).toBeVisible()
    await row.getByRole('button', { name: t.confirm, exact: true }).click()
    const dialog = this.adminPage.getByRole('dialog', { name: t.confirm, exact: true })
    await dialog.getByLabel(t.amount, { exact: true }).fill('1499.50')
    await dialog.getByLabel(t.note, { exact: true }).fill('SYNTHETIC bank receipt checked for T05 invoice')
    await dialog.getByRole('button', { name: t.confirm, exact: true }).click()
    await expect(dialog).not.toBeVisible()
    await expect(row).toHaveCount(0)
    await expect(this.adminPage.getByRole('status').filter({ hasText: t.confirmed })).toBeVisible()
    expect((await db.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe('PAID')
    expect(await db.creditLedger.count({ where: { refType: 'Order', refId: order.id } })).toBe(1)
    expect(await db.subscription.count({ where: { orderId: order.id } })).toBe(1)
    await runInvoiceChild(this.marker, owner.actor.companyId, order.id, 'issue')
    const invoice = await db.invoice.findUniqueOrThrow({ where: { orderId: order.id } })
    expect(invoice.pdfStatus).toBe('QUEUED')
    return { owner, order, plan, invoice, buyer }
  }
}

export async function runInvoiceChild(marker: string, companyId: string, orderId: string, mode: 'issue' | 'process') {
  if (process.env.APP_ENV === 'production' || process.env.APP_ENV === 'staging') throw new Error('Unsafe task environment')
  const testUrl = validateTestDbUrl(process.env.TEST_DATABASE_URL)
  const root = process.cwd()
  const require = createRequire(resolve(root, 'package.json'))
  const loader = pathToFileURL(require.resolve('tsx')).href
  const entry = resolve(root, 'tests/e2e/helpers/invoice-task-child.ts')
  await new Promise<void>((done, reject) => {
    const child = spawn(process.execPath, ['--import', loader, '--conditions=react-server', entry], {
      cwd: root, shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, DATABASE_URL: testUrl, MIGRATE_DATABASE_URL: testUrl, WORKER_DATABASE_URL: testUrl, TEST_DATABASE_URL: testUrl },
    })
    let count = 0, output = '', failed = false
    const deadline = setTimeout(() => { failed = true; child.kill('SIGKILL') }, 90_000)
    const capture = (data: Buffer) => {
      count += data.byteLength
      if (count > 64 * 1024) { failed = true; child.kill('SIGKILL'); return }
      output += data.toString('utf8')
    }
    child.stdout.on('data', capture); child.stderr.on('data', capture)
    child.on('error', () => { clearTimeout(deadline); reject(new Error('Invoice child failed to start')) })
    child.on('close', code => {
      clearTimeout(deadline)
      if (!failed && code === 0 && output.includes('T05_INVOICE_TASK_OK')) done()
      else reject(new Error('Invoice child failed; no raw child output is displayed'))
    })
    child.stdin.on('error', () => { failed = true })
    child.stdin.end(JSON.stringify({ marker, companyId, orderId, mode }))
  })
}

export async function invoiceState(orderId: string) {
  const invoice = await db.invoice.findUniqueOrThrow({ where: { orderId } })
  const counters = await db.invoiceCounter.findMany({ orderBy: { scope: 'asc' }, select: { scope: true, lastValue: true } })
  return {
    invoice: { id: invoice.id, invoiceNo: invoice.invoiceNo, invoiceSnapshot: invoice.invoiceSnapshot, pdfStatus: invoice.pdfStatus,
      pdfAttempts: invoice.pdfAttempts, pdfKey: invoice.pdfKey, pdfSha256: invoice.pdfSha256 },
    counter: counters.map(row => ({ scope: row.scope, value: row.lastValue.toString() })),
    invoiceCount: await db.invoice.count({ where: { orderId } }),
    ledgerCount: await db.creditLedger.count({ where: { refType: 'Order', refId: orderId } }),
    subscriptionCount: await db.subscription.count({ where: { orderId } }),
  }
}

export async function downloadAndCheck(page: Page, locale: Locale, invoiceId: string, invoiceNo: string, info: TestInfo, label: string) {
  const route = '/api/invoices/' + invoiceId + '/download'
  const button = page.getByTestId('order-invoice').getByRole('button', { name: copy(locale).billingInvoice.download, exact: true })
  await expect(button).toBeEnabled()
  const [response, download] = await Promise.all([
    page.waitForResponse(result => new URL(result.url()).pathname === route && result.request().method() === 'GET', { timeout: 30_000 }),
    page.waitForEvent('download', { timeout: 30_000 }),
    button.click(),
  ])
  expect(response.status()).toBe(200)
  const headers = response.headers()
  expect(headers['content-type']).toContain('application/pdf')
  expect(headers['content-disposition']).toBe('attachment; filename="' + invoiceNo + '.pdf"')
  expect(headers['cache-control']).toContain('private'); expect(headers['cache-control']).toContain('no-store')
  expect(headers['x-content-type-options']).toBe('nosniff')
  expect(headers['x-robots-tag']).toContain('noindex'); expect(headers['x-robots-tag']).toContain('nofollow')
  expect(headers.location).toBeUndefined(); expect(download.suggestedFilename()).toBe(invoiceNo + '.pdf')
  const file = info.outputPath(label + '.pdf')
  await download.saveAs(file)
  const size = (await stat(file)).size
  expect(size).toBeGreaterThan(5); expect(size).toBeLessThanOrEqual(8 * 1024 * 1024)
  const bytes = await readFile(file)
  expect(bytes.subarray(0, 5).toString()).toBe('%PDF-')
  const parsed = await PDFDocument.load(bytes)
  expect(parsed.getPageCount()).toBeGreaterThan(0); expect(parsed.getPageCount()).toBeLessThanOrEqual(4)
  await info.attach(label, { path: file, contentType: 'application/pdf' })
  return { bytes, hash: createHash('sha256').update(bytes).digest('hex') }
}
