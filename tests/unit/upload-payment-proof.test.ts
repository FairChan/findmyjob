/**
 * Real route wrapper and PDF/type validators; external storage, authentication,
 * DB persistence, rate-limit, and log delivery are mocked. No network or DB.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  putObject: vi.fn(), deleteAllVersions: vi.fn(), createProof: vi.fn(),
  requireUser: vi.fn(), requireCompanyMember: vi.fn(), logAudit: vi.fn(),
  logger: { fatal: vi.fn(), error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn(), trace: vi.fn() },
}))
vi.mock('@/lib/storage', () => ({ putObject: mocks.putObject, deleteAllVersions: mocks.deleteAllVersions }))
vi.mock('@/server/db', () => ({ db: { paymentProofUpload: { create: mocks.createProof } } }))
vi.mock('@/server/authz', () => ({
  requireUser: mocks.requireUser, requireCompanyMember: mocks.requireCompanyMember,
}))
vi.mock('@/server/services/audit', () => ({ logAudit: mocks.logAudit }))
vi.mock('@/server/lib/logger', () => ({ pinoOptions: {}, logger: mocks.logger }))
vi.mock('@/server/services/settings', () => ({
  getSetting: vi.fn(async (_key: string, fallback: unknown) => fallback),
}))
vi.mock('@/server/services/feature-flags', () => ({ assertUploadsEnabled: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/server/lib/rate-limit', () => ({ checkRateLimit: vi.fn().mockResolvedValue({ allowed: true }) }))

import { POST } from '@/app/api/uploads/[purpose]/route'
import { ForbiddenError } from '@/server/errors'

const ORIGIN = 'https://uploads.example.test'
const COMPANY = 'synthetic-payment-company'
const USER = 'synthetic-owner-user'
const BYTES = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==',
  'base64',
)

function request(options: { bytes?: Uint8Array; origin?: string; name?: string } = {}) {
  const form = new FormData()
  form.set('file', new File([new Uint8Array(options.bytes ?? BYTES)], options.name ?? 'synthetic-proof.png', { type: 'image/png' }))
  // These untrusted fields must never influence the generated path or ownership.
  form.set('companyId', 'attacker-company')
  form.set('key', 'payment_proofs/attacker-company/chosen.png')
  form.set('uploaderId', 'attacker-user')
  return new Request(ORIGIN + '/api/uploads/PAYMENT_PROOF', {
    method: 'POST', headers: { Origin: options.origin ?? ORIGIN }, body: form,
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('APP_URL', ORIGIN)
  mocks.putObject.mockReset().mockResolvedValue(undefined)
  mocks.deleteAllVersions.mockReset().mockResolvedValue(undefined)
  mocks.createProof.mockReset().mockResolvedValue({ id: 'proof-upload-01' })
  mocks.requireUser.mockReset().mockResolvedValue({ userId: USER })
  mocks.requireCompanyMember.mockReset().mockResolvedValue({ userId: USER, companyId: COMPANY, role: 'OWNER' })
  mocks.logAudit.mockReset().mockResolvedValue(undefined)
})
afterEach(() => vi.unstubAllEnvs())

describe('M8-T02 PAYMENT_PROOF upload records', () => {
  it('persists server ownership and detected type/size after upload, retaining key response compatibility', async () => {
    const response = await POST(request())
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body).toMatchObject({ ok: true, key: expect.any(String) })
    const [key] = mocks.putObject.mock.calls[0]
    expect(key).toMatch(/^payment_proofs\/synthetic-payment-company\/[0-9a-f-]{36}\.png$/)
    expect(body.key).toBe(key)
    expect(mocks.requireCompanyMember).toHaveBeenCalledWith('OWNER', expect.any(Headers))
    expect(mocks.putObject).toHaveBeenCalledExactlyOnceWith(key, BYTES, 'image/png')
    expect(mocks.createProof).toHaveBeenCalledExactlyOnceWith({
      data: {
        companyId: COMPANY, uploaderId: USER, storageKey: key,
        mimeType: 'image/png', sizeBytes: BYTES.length,
      },
    })
    expect(mocks.putObject.mock.invocationCallOrder[0]).toBeLessThan(mocks.createProof.mock.invocationCallOrder[0])
    expect(mocks.deleteAllVersions).not.toHaveBeenCalled()
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(response.headers.get('x-robots-tag')).toBe('noindex, nofollow')
  })

  it('compensates only the new object when recording the successful upload fails', async () => {
    mocks.createProof.mockRejectedValueOnce(new Error('synthetic record failure'))
    const response = await POST(request())
    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({ ok: false, code: 'INTERNAL_ERROR' })
    const [key] = mocks.putObject.mock.calls[0]
    expect(mocks.deleteAllVersions).toHaveBeenCalledExactlyOnceWith(key)
    expect(mocks.createProof.mock.invocationCallOrder[0]).toBeLessThan(mocks.deleteAllVersions.mock.invocationCallOrder[0])
  })

  it('does not persist a record or delete an object when upload itself fails', async () => {
    mocks.putObject.mockRejectedValueOnce(new Error('synthetic storage failure'))
    const response = await POST(request())
    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({ ok: false, code: 'INTERNAL_ERROR' })
    expect(mocks.createProof).not.toHaveBeenCalled()
    expect(mocks.deleteAllVersions).not.toHaveBeenCalled()
  })

  it('returns a generic error and omits proof keys/content from logs even when compensation fails', async () => {
    mocks.createProof.mockRejectedValueOnce(new Error('synthetic record failure'))
    mocks.deleteAllVersions.mockImplementationOnce(async (key: string) => {
      // Storage errors may themselves contain the private key.
      throw new Error('synthetic cleanup failure: ' + key)
    })
    const response = await POST(request())
    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({ ok: false, code: 'INTERNAL_ERROR' })
    const [key] = mocks.putObject.mock.calls[0]
    expect(mocks.deleteAllVersions).toHaveBeenCalledExactlyOnceWith(key)
    const logs = Object.values(mocks.logger).flatMap((mock) => mock.mock.calls)
    const serialized = JSON.stringify(logs, (_name, value: unknown) => value instanceof Error ? value.message : value)
    expect(serialized).not.toContain(key)
    expect(serialized).not.toContain(BYTES.toString('base64'))
    expect(JSON.stringify(mocks.logAudit.mock.calls)).not.toContain(key)
  })

  it('requires a current OWNER before storage or record insertion', async () => {
    mocks.requireCompanyMember.mockRejectedValueOnce(new ForbiddenError())
    const response = await POST(request())
    expect(response.status).toBe(403)
    expect(await response.json()).toEqual({ ok: false, code: 'FORBIDDEN' })
    expect(mocks.putObject).not.toHaveBeenCalled()
    expect(mocks.createProof).not.toHaveBeenCalled()
  })

  it('keeps the real Origin guard for payment-proof uploads', async () => {
    const response = await POST(request({ origin: 'https://attacker.example.test' }))
    expect(response.status).toBe(403)
    expect(mocks.requireUser).not.toHaveBeenCalled()
    expect(mocks.putObject).not.toHaveBeenCalled()
    expect(mocks.createProof).not.toHaveBeenCalled()
  })

  it.each([
    { label: 'oversize', bytes: new Uint8Array(10 * 1024 * 1024 + 1), status: 413, code: 'FILE_TOO_LARGE' },
    { label: 'fake PNG bytes', bytes: new TextEncoder().encode('not an image'), status: 400, code: 'INVALID_FILE_TYPE' },
  ])('does not store or record $label', async ({ bytes, status, code }) => {
    const response = await POST(request({ bytes }))
    expect(response.status).toBe(status)
    expect(await response.json()).toEqual({ ok: false, code })
    expect(mocks.putObject).not.toHaveBeenCalled()
    expect(mocks.createProof).not.toHaveBeenCalled()
    expect(mocks.deleteAllVersions).not.toHaveBeenCalled()
  })
})
