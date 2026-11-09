/** Fixed test-only child entry, never an HTTP endpoint. No raw output/PII. */
import { loadEnvConfig } from '@next/env'
import { validateTestDbUrl } from '../../lib/validate-test-db-url'

async function main() {
  if (process.env.APP_ENV === 'production' || process.env.APP_ENV === 'staging') throw new Error('Unsafe environment')
  const testUrl = validateTestDbUrl(process.env.TEST_DATABASE_URL)
  process.env.DATABASE_URL = testUrl
  process.env.MIGRATE_DATABASE_URL = testUrl
  process.env.WORKER_DATABASE_URL = testUrl
  loadEnvConfig(process.cwd())
  delete process.env.SKIP_ENV_VALIDATION
  if (process.env.APP_ENV === 'production' || process.env.APP_ENV === 'staging') throw new Error('Unsafe environment')
  if ([process.env.DATABASE_URL, process.env.MIGRATE_DATABASE_URL, process.env.WORKER_DATABASE_URL]
    .some(url => url !== testUrl)) throw new Error('Database mismatch')
  const endpoint = new URL(process.env.S3_ENDPOINT ?? '')
  if (!['localhost', '127.0.0.1', '[::1]'].includes(endpoint.hostname)) throw new Error('Local storage required')
  // These controlled local tasks never need provider APIs or remote telemetry.
  process.env.STRIPE_SECRET_KEY = ''
  process.env.SENTRY_DSN = ''
  process.env.NEXT_PUBLIC_SENTRY_DSN = ''
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of process.stdin) {
    const bytes = Buffer.from(chunk)
    size += bytes.length
    if (size > 2048) throw new Error('Oversized fixture input')
    chunks.push(bytes)
  }
  const input: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'))
  if (!input || typeof input !== 'object') throw new Error('Invalid fixture input')
  const value = input as Record<string, unknown>
  if (Object.keys(value).sort().join(',') !== 'companyId,marker,mode,orderId'
    || typeof value.marker !== 'string' || !/^M8T02_[A-F0-9]{12}$/.test(value.marker)
    || typeof value.orderId !== 'string' || !/^c[a-z0-9]{24}$/.test(value.orderId)
    || typeof value.companyId !== 'string' || !/^c[a-z0-9]{24}$/.test(value.companyId)
    || !['issue', 'process'].includes(String(value.mode))) throw new Error('Invalid fixture input')
  const { env } = await import('../../../src/env')
  if (env.APP_ENV === 'production' || env.APP_ENV === 'staging') throw new Error('Unsafe resolved environment')
  const { db } = await import('../../../src/server/db')
  try {
    const order = await db.order.findUnique({ where: { id: value.orderId }, select: {
      id: true, companyId: true, status: true, company: { select: { legalName: true, isActive: true } },
      plan: { select: { code: true } },
    } })
    if (!order || order.companyId !== value.companyId || order.status !== 'PAID'
      || !order.company.isActive || !order.company.legalName.startsWith(value.marker + ' ')
      || !order.plan?.code.startsWith(value.marker + '_')) throw new Error('Unowned paid order')
    if (value.mode === 'issue') {
      const { ensureInvoiceForPaidOrder } = await import('../../../src/server/services/invoices')
      await ensureInvoiceForPaidOrder(order.id)
    } else {
      // The real runner is intentionally unscoped. Refuse any unrelated work,
      // including exhausted attempts that the runner may terminate rather than render.
      const foreignPaidWithoutInvoice = await db.order.count({ where: { status: 'PAID', invoice: null, id: { not: order.id } } })
      const foreignDue = await db.invoice.count({ where: { orderId: { not: order.id }, OR: [
        { pdfStatus: 'QUEUED' }, { pdfStatus: 'FAILED', pdfNextAttemptAt: { not: null } }, { pdfStatus: 'PROCESSING' },
      ] } })
      if (foreignPaidWithoutInvoice || foreignDue) throw new Error('Unrelated invoice work exists')
      const { runInvoiceTasks } = await import('../../../src/server/jobs/invoice-tasks')
      await runInvoiceTasks()
    }
    const result = await db.invoice.findUniqueOrThrow({ where: { orderId: order.id }, select: { pdfStatus: true } })
    if (value.mode === 'process' && result.pdfStatus !== 'READY') throw new Error('PDF not ready')
    process.stdout.write('T05_INVOICE_TASK_OK\n')
  } finally { await db.$disconnect() }
}
main().catch(() => { process.stderr.write('T05_INVOICE_TASK_FAILED\n'); process.exitCode = 1 })
