import { describe, expect, it } from 'vitest'
import {
  configuredInvoiceIssuerSchema, EMPTY_INVOICE_ISSUER, INVOICE_ISSUER_LIMITS,
  invoiceIssuerSettingsSchema,
} from '@/server/lib/invoice-settings'

const complete = {
  schemaVersion: 1,
  version: ' SYNTHETIC_ISSUER_VERSION_801 ',
  legalName: '  SYNTHETIC_ISSUER_802 法定 & Co  ',
  address: '  SYNTHETIC_ADDRESS_803\nSuite 2  ',
  registrationNo: '00000804',
}

describe('invoice issuer settings contract', () => {
  it('defaults to an empty disabled issuer, which issuance rejects', () => {
    expect(EMPTY_INVOICE_ISSUER).toEqual({ schemaVersion: 1, version: '', legalName: '', address: '', registrationNo: null })
    expect(invoiceIssuerSettingsSchema.parse(EMPTY_INVOICE_ISSUER)).toEqual(EMPTY_INVOICE_ISSUER)
    expect(configuredInvoiceIssuerSchema.safeParse(EMPTY_INVOICE_ISSUER).success).toBe(false)
  })

  it('preserves complete legal text, whitespace, line breaks and leading zeroes', () => {
    expect(invoiceIssuerSettingsSchema.parse(complete)).toEqual(complete)
    expect(configuredInvoiceIssuerSchema.parse(complete)).toEqual(complete)
    expect(configuredInvoiceIssuerSchema.parse({ ...complete, registrationNo: null }).registrationNo).toBeNull()
  })

  it.each(['version', 'legalName', 'address'] as const)('rejects a missing or blank required %s', field => {
    for (const value of ['', ' \n ', undefined]) {
      expect(invoiceIssuerSettingsSchema.safeParse({ ...complete, [field]: value }).success).toBe(false)
    }
  })

  it('rejects optional registration data without the required issuer fields', () => {
    expect(invoiceIssuerSettingsSchema.safeParse({ ...EMPTY_INVOICE_ISSUER, registrationNo: '00000804' }).success).toBe(false)
    const whitespace = { ...EMPTY_INVOICE_ISSUER, version: ' ', legalName: '\t', address: '\n' }
    expect(invoiceIssuerSettingsSchema.safeParse(whitespace).success).toBe(true)
    expect(configuredInvoiceIssuerSchema.safeParse(whitespace).success).toBe(false)
  })

  it.each(Object.entries(INVOICE_ISSUER_LIMITS))('accepts the exact %s limit and rejects overflow', (field, limit) => {
    expect(configuredInvoiceIssuerSchema.safeParse({ ...complete, [field]: 'x'.repeat(limit) }).success).toBe(true)
    expect(invoiceIssuerSettingsSchema.safeParse({ ...complete, [field]: 'x'.repeat(limit + 1) }).success).toBe(false)
  })

  it('retains the frozen version, field types and strict shape', () => {
    for (const value of [
      { ...complete, schemaVersion: 2 }, { ...complete, schemaVersion: undefined },
      { ...complete, legalName: 'x' }, { ...complete, registrationNo: 804 },
      { ...complete, registrationNo: undefined }, { ...complete, taxRate: 0 },
    ]) expect(invoiceIssuerSettingsSchema.safeParse(value).success).toBe(false)
  })
})
