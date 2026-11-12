import { z } from 'zod'
import { route } from '@/server/route'
import { requireCompanyMember } from '@/server/authz'
import { AppError, ForbiddenError, NotFoundError } from '@/server/errors'
import { getInvoiceDownload } from '@/server/services/invoice-delivery'

const invoiceIdSchema = z.string().cuid()
const numberSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/)

export const GET = route({ auth: { type: 'company', minRole: 'OWNER' } }, async (req, ctx) => {
  const id = invoiceIdSchema.safeParse(new URL(req.url).pathname.split('/').at(-2))
  if (!id.success) throw new NotFoundError()
  const unavailable = () => new AppError('Invoice PDF is unavailable', 'INVOICE_PDF_UNAVAILABLE', 503)
  if (req.signal.aborted) throw unavailable()
  const result = await getInvoiceDownload({ userId: ctx.userId! }, id.data)
  // The service rechecks membership; the route also rechecks the live session after I/O.
  const current = await requireCompanyMember('OWNER', req.headers)
  if (current.userId !== ctx.userId || current.companyId !== ctx.companyId) throw new ForbiddenError()
  if (req.signal.aborted || !numberSchema.safeParse(result.invoiceNo).success) throw unavailable()
  return new Response(new Uint8Array(result.bytes), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Length': String(result.bytes.length),
      'Content-Disposition': `attachment; filename="${result.invoiceNo}.pdf"`,
      'Cache-Control': 'private, no-store',
      'X-Robots-Tag': 'noindex, nofollow',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "sandbox; default-src 'none'",
    },
  })
})
