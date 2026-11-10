import { beforeEach, describe, expect, it, vi } from 'vitest'
import { setMarketingConsentAction } from '@/server/actions/marketing-consent'
import { ForbiddenError, VersionMismatchError } from '@/server/errors'

const io = vi.hoisted(() => ({ auth: vi.fn(), save: vi.fn() }))
vi.mock('next/headers', () => ({ headers: async () => new Headers() }))
vi.mock('@/server/authz', () => ({ requireUser: io.auth }))
vi.mock('@/server/services/marketing-consent', () => ({ setMarketingConsent: io.save }))
vi.mock('@/server/lib/logger', () => ({ logger: { error: vi.fn() } }))
beforeEach(() => { vi.clearAllMocks(); io.auth.mockResolvedValue({ userId: 'synthetic-user' }); io.save.mockResolvedValue(undefined) })

describe('marketing action actor and intent boundaries', () => {
  it('authenticates the actor and passes only a validated explicit grant', async () => {
    expect(await setMarketingConsentAction({ granted: true, submittedVersion: 'synthetic-v1' })).toEqual({ ok: true, data: {} })
    expect(io.auth).toHaveBeenCalledExactlyOnceWith(expect.any(Headers))
    expect(io.save).toHaveBeenCalledExactlyOnceWith({ userId: 'synthetic-user' }, { granted: true, submittedVersion: 'synthetic-v1' })
  })
  it.each([{ granted: false }, { granted: false, submittedVersion: null }])('accepts a withdrawal without a usable version: %j', async input => {
    expect(await setMarketingConsentAction(input)).toEqual({ ok: true, data: {} })
    expect(io.save).toHaveBeenCalledExactlyOnceWith({ userId: 'synthetic-user' }, input)
  })
  it.each([
    { granted: true }, { granted: true, submittedVersion: null }, { granted: true, submittedVersion: '' },
    { granted: false, userId: 'another-user' }, { granted: false, companyId: 'another-company' },
    { granted: false, email: 'recipient@example.test' }, { granted: false, kind: 'AI_MATCHING' },
  ])('rejects missing grant version and caller-selected actor or scope: %j', async input => {
    expect(await setMarketingConsentAction(input)).toEqual({ ok: false, code: 'VALIDATION_ERROR' })
    expect(io.save).not.toHaveBeenCalled()
  })
  it('does not call the service when authentication fails', async () => {
    io.auth.mockRejectedValue(new ForbiddenError())
    expect(await setMarketingConsentAction({ granted: false })).toEqual({ ok: false, code: 'FORBIDDEN' })
    expect(io.save).not.toHaveBeenCalled()
  })
  it('preserves controlled service version errors without exposing the exception', async () => {
    io.save.mockRejectedValue(new VersionMismatchError('PRIVATE_VERSION_DETAILS'))
    expect(await setMarketingConsentAction({ granted: true, submittedVersion: 'old' })).toEqual({ ok: false, code: 'VERSION_MISMATCH' })
  })
})
