import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ admin: vi.fn(), save: vi.fn() }))
vi.mock('next/headers', () => ({ headers: async () => new Headers() }))
vi.mock('@/server/authz', () => ({ requireAdmin: mocks.admin }))
vi.mock('@/server/services/admin-settings', () => ({ updateSettingAdmin: mocks.save }))
vi.mock('@/server/lib/logger', () => ({ logger: { error: vi.fn() } }))

import { saveInvoiceIssuerSettingsAction } from '@/app/[locale]/admin/settings/actions'
import { EMPTY_INVOICE_ISSUER } from '@/server/lib/invoice-settings'
import { ForbiddenError } from '@/server/errors'

beforeEach(() => {
  mocks.admin.mockReset().mockResolvedValue({ userId: 'synthetic-admin' })
  mocks.save.mockReset().mockResolvedValue(undefined)
})

describe('invoice issuer action boundary', () => {
  it('requires admin auth and passes the validated disabled state to the fixed setting key', async () => {
    expect(await saveInvoiceIssuerSettingsAction(EMPTY_INVOICE_ISSUER)).toEqual({ ok: true, data: undefined })
    expect(mocks.admin).toHaveBeenCalledExactlyOnceWith(expect.any(Headers), { fresh: false })
    expect(mocks.save).toHaveBeenCalledExactlyOnceWith({ userId: 'synthetic-admin' }, 'billing.invoiceIssuer', EMPTY_INVOICE_ISSUER)
  })

  it('rejects malformed configuration and does not accept a client-selected setting key', async () => {
    expect(await saveInvoiceIssuerSettingsAction({ ...EMPTY_INVOICE_ISSUER, legalName: 'Synthetic issuer' }))
      .toEqual({ ok: false, code: 'VALIDATION_ERROR' })
    expect(await saveInvoiceIssuerSettingsAction({ ...EMPTY_INVOICE_ISSUER, key: 'billing.enabled' }))
      .toEqual({ ok: false, code: 'VALIDATION_ERROR' })
    expect(mocks.save).not.toHaveBeenCalled()
  })

  it('does not save when admin authentication fails', async () => {
    mocks.admin.mockRejectedValueOnce(new ForbiddenError())
    expect(await saveInvoiceIssuerSettingsAction(EMPTY_INVOICE_ISSUER)).toEqual({ ok: false, code: 'FORBIDDEN' })
    expect(mocks.save).not.toHaveBeenCalled()
  })
})
