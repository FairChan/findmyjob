import { beforeEach, describe, expect, it, vi } from 'vitest'
const io = vi.hoisted(() => ({ student: vi.fn(), company: vi.fn(), admin: vi.fn(), jobs: vi.fn(), talents: vi.fn(), consent: vi.fn(), gate: vi.fn() }))
vi.mock('next/headers', () => ({ headers: async () => new Headers() }))
vi.mock('@/server/authz', () => ({ requireStudent: io.student, requireVerifiedCompany: io.company, requireAdmin: io.admin }))
vi.mock('@/server/services/semantic-matching', () => ({ recommendJobs: io.jobs, recommendTalents: io.talents, setMatchingConsent: io.consent }))
vi.mock('@/server/services/admin-settings', () => ({ updateMatchingSettingsAdmin: io.gate, updateJdAssistantSettingsAdmin: vi.fn(), updateSettingAdmin: vi.fn() }))
vi.mock('@/server/lib/logger', () => ({ logger: { error: vi.fn() } }))
import { recommendJobsAction, recommendTalentsAction, setMatchingConsentAction } from '@/server/actions/semantic-matching'
import { saveMatchingSettingsAction } from '@/app/[locale]/admin/settings/actions'
import { ForbiddenError } from '@/server/errors'
import { MATCHING_CONFIGURATION_ID } from '@/schemas/semantic-matching'
const jobId = 'c' + '1'.repeat(24)
beforeEach(() => {
  vi.clearAllMocks()
  io.student.mockReset().mockResolvedValue({ userId: 'student' })
  io.company.mockReset().mockResolvedValue({ userId: 'employer', companyId: 'company', role: 'RECRUITER' })
  io.admin.mockReset().mockResolvedValue({ userId: 'admin' })
  io.jobs.mockResolvedValue({ items: [], availability: 'unavailable' })
  io.talents.mockResolvedValue({ items: [], availability: 'ready' })
})
describe('matching actions use the standard authenticated wrapper', () => {
  it('derives student and verified recruiter context and parses defaults', async () => {
    expect(await recommendJobsAction({})).toEqual({ ok: true, data: { items: [], availability: 'unavailable' } })
    expect(io.jobs).toHaveBeenCalledExactlyOnceWith({ userId: 'student' }, { limit: 10 })
    expect(await recommendTalentsAction({ jobId })).toEqual({ ok: true, data: { items: [], availability: 'ready' } })
    expect(io.company).toHaveBeenCalledExactlyOnceWith('RECRUITER', expect.any(Headers))
    expect(io.talents).toHaveBeenCalledExactlyOnceWith({ userId: 'employer', companyId: 'company' }, { jobId, limit: 10 })
  })
  it.each(['userId', 'companyId', 'vector', 'model', 'configurationId', 'canSeeDescription'])('rejects caller field %s', async key => {
    expect(await recommendJobsAction({ [key]: 'untrusted' })).toEqual({ ok: false, code: 'VALIDATION_ERROR' })
    expect(await recommendTalentsAction({ jobId, [key]: 'untrusted' })).toEqual({ ok: false, code: 'VALIDATION_ERROR' })
    expect(io.jobs).not.toHaveBeenCalled()
    expect(io.talents).not.toHaveBeenCalled()
  })
  it('permits withdrawal without a live legal version and never indexes automatically', async () => {
    expect(await setMatchingConsentAction({ granted: false, submittedVersion: null })).toEqual({ ok: true, data: undefined })
    expect(io.consent).toHaveBeenCalledExactlyOnceWith({ userId: 'student' }, { granted: false, submittedVersion: null })
    expect(io.jobs).not.toHaveBeenCalled()
    expect(await setMatchingConsentAction({ granted: true })).toEqual({ ok: false, code: 'VALIDATION_ERROR' })
  })
  it('rejects actor failures before invoking services', async () => {
    io.student.mockRejectedValueOnce(new ForbiddenError())
    expect(await recommendJobsAction({})).toEqual({ ok: false, code: 'FORBIDDEN' })
    expect(io.jobs).not.toHaveBeenCalled()
  })
  it('requires a fresh admin session and rejects caller epoch', async () => {
    const value = { enabled: false, legalVersion: null, configurationId: MATCHING_CONFIGURATION_ID }
    expect(await saveMatchingSettingsAction(value)).toEqual({ ok: true, data: undefined })
    expect(io.admin).toHaveBeenCalledExactlyOnceWith(expect.any(Headers), { fresh: true })
    expect(io.gate).toHaveBeenCalledExactlyOnceWith({ userId: 'admin' }, value)
    io.gate.mockClear()
    expect(await saveMatchingSettingsAction({ ...value, epoch: '00000000-0000-4000-8000-000000000000' })).toEqual({ ok: false, code: 'VALIDATION_ERROR' })
    expect(io.gate).not.toHaveBeenCalled()
  })
})
