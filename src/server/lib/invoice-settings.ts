import { z } from 'zod'

export const INVOICE_ISSUER_LIMITS = {
  version: 100,
  legalName: 200,
  address: 500,
  registrationNo: 50,
} as const

export const EMPTY_INVOICE_ISSUER = {
  schemaVersion: 1 as const,
  version: '',
  legalName: '',
  address: '',
  registrationNo: null,
}

const requiredFields = ['version', 'legalName', 'address'] as const
const hasText = (value: string) => value.trim().length > 0

// Validate without trimming or truncating the legal text stored on invoices.
export const invoiceIssuerSettingsSchema = z.object({
  schemaVersion: z.literal(1),
  version: z.string().max(INVOICE_ISSUER_LIMITS.version),
  legalName: z.string().max(INVOICE_ISSUER_LIMITS.legalName),
  address: z.string().max(INVOICE_ISSUER_LIMITS.address),
  registrationNo: z.string().max(INVOICE_ISSUER_LIMITS.registrationNo).nullable(),
}).strict().superRefine((value, ctx) => {
  const empty = requiredFields.every(field => !hasText(value[field]))
    && !hasText(value.registrationNo ?? '')
  if (empty) return
  for (const field of requiredFields) {
    if (!hasText(value[field])) {
      ctx.addIssue({ code: 'custom', path: [field], message: 'Complete all required issuer fields or clear the configuration' })
    }
  }
  if (hasText(value.legalName) && value.legalName.length < 2) {
    ctx.addIssue({ code: 'custom', path: ['legalName'], message: 'The legal name must contain at least two characters' })
  }
})

// Issuance must reject the valid, intentionally disabled settings state.
export const configuredInvoiceIssuerSchema = invoiceIssuerSettingsSchema.refine(
  value => requiredFields.every(field => hasText(value[field])),
  { message: 'Invoice issuer is not configured' },
)

export type InvoiceIssuerSettings = z.infer<typeof invoiceIssuerSettingsSchema>
