import { beforeEach, describe, expect, it, vi } from 'vitest'

const io = vi.hoisted(() => ({ member: vi.fn(), admin: vi.fn(), generate: vi.fn(), gate: vi.fn() }))
vi.mock('next/headers', () => ({ headers: async () => new Headers() }))
vi.mock('@/server/authz', () => ({ requireCompanyMember: io.member, requireAdmin: io.admin }))
vi.mock('@/server/services/jd-assistant', () => ({ generateJobDescription: io.generate }))
vi.mock('@/server/services/admin-settings', () => ({ updateSettingAdmin: vi.fn(), updateJdAssistantSettingsAdmin: io.gate }))
vi.mock('@/server/lib/logger', () => ({ logger: { error: vi.fn() } }))

import { generateJobDescriptionAction } from '@/server/actions/jd-assistant'
import { saveJdAssistantSettingsAction } from '@/app/[locale]/admin/settings/actions'
import { ForbiddenError } from '@/server/errors'

const input = { title: ' Synthetic role ', points: ' Synthetic duties ', acknowledged: true, submittedVersion: 'synthetic-jd-policy' }
beforeEach(() => {
  io.member.mockReset().mockResolvedValue({ userId: 'employer', companyId: 'company', role: 'RECRUITER' })
  io.admin.mockReset().mockResolvedValue({ userId: 'admin' })
  io.generate.mockReset().mockResolvedValue({ zh: '合成建议', en: 'Synthetic suggestion' })
  io.gate.mockReset().mockResolvedValue(undefined)
})

describe('JD action boundaries', () => {
  it('uses the authenticated recruiter context and sends only the validated four-field input', async () => {
    expect(await generateJobDescriptionAction(input)).toEqual({ ok: true, data: { zh: '合成建议', en: 'Synthetic suggestion' } })
    expect(io.member).toHaveBeenCalledExactlyOnceWith('RECRUITER', expect.any(Headers))
    expect(io.generate).toHaveBeenCalledExactlyOnceWith(
      { userId: 'employer', companyId: 'company', role: 'RECRUITER' },
      { ...input, title: 'Synthetic role', points: 'Synthetic duties' },
    )
  })

  it.each(['companyId', 'jobId', 'model', 'host'])('rejects client-selected %s', async key => {
    expect(await generateJobDescriptionAction({ ...input, [key]: 'untrusted' })).toEqual({ ok: false, code: 'VALIDATION_ERROR' })
    expect(io.generate).not.toHaveBeenCalled()
  })

  it('requires an acknowledgement for each request', async () => {
    expect(await generateJobDescriptionAction({ ...input, acknowledged: false })).toEqual({ ok: false, code: 'VALIDATION_ERROR' })
    expect(io.generate).not.toHaveBeenCalled()
  })

  it('stops at failed company authentication', async () => {
    io.member.mockRejectedValueOnce(new ForbiddenError())
    expect(await generateJobDescriptionAction(input)).toEqual({ ok: false, code: 'FORBIDDEN' })
    expect(io.generate).not.toHaveBeenCalled()
  })

  it('requires fresh admin authentication and never accepts a supplied epoch or setting key', async () => {
    const disabled = { enabled: false, legalVersion: null }
    expect(await saveJdAssistantSettingsAction(disabled)).toEqual({ ok: true, data: undefined })
    expect(io.admin).toHaveBeenCalledExactlyOnceWith(expect.any(Headers), { fresh: true })
    expect(io.gate).toHaveBeenCalledExactlyOnceWith({ userId: 'admin' }, disabled)
    io.gate.mockClear()
    for (const extra of [{ epoch: '00000000-0000-4000-8000-000000000000' }, { key: 'ai.resumeParse' }]) {
      expect(await saveJdAssistantSettingsAction({ ...disabled, ...extra })).toEqual({ ok: false, code: 'VALIDATION_ERROR' })
    }
    expect(io.gate).not.toHaveBeenCalled()
  })
})
