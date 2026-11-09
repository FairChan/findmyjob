// @vitest-environment jsdom
/** Report-only T04 component behavior. Real forms/dialogs/React; action and
 * navigation boundaries mocked. No DB, paid fixture, or service guarantee. */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import JobFormClient, { type JobFormData } from '@/components/jobs/job-form-client'
import TeamPageClient from '@/components/team/team-page-client'
import AcceptInviteClient from '@/components/team/accept-invite-client'
import { InviteDialog } from '@/components/invitations/InviteDialog'
import { InviteButton } from '@/components/invitations/InviteButton'
import { ReviewJobForm } from '@/app/[locale]/admin/jobs/[jobId]/review-job-form'
import { setupUi, mount, messages, jobLabels, button, click, fill, select, submit, type Locale } from '../helpers/entitlements-ui-t04'

const mocks = vi.hoisted(() => ({ invite: vi.fn(), accept: vi.fn(), send: vi.fn(), approve: vi.fn(), reject: vi.fn(), push: vi.fn(), refresh: vi.fn() }))
vi.mock('@/server/actions/team', () => ({ inviteMemberAction: mocks.invite, acceptInviteAction: mocks.accept, removeMemberAction: vi.fn(), changeRoleAction: vi.fn() }))
vi.mock('@/server/actions/invitations', () => ({ sendInvitationAction: mocks.send }))
vi.mock('@/server/actions/admin-jobs', () => ({ approveJobAction: mocks.approve, rejectJobAction: mocks.reject }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: mocks.push, refresh: mocks.refresh }) }))
vi.mock('@/i18n/navigation', () => ({
  useRouter: () => ({ push: mocks.push, refresh: mocks.refresh }),
  Link: ({ href, children, ...props }: React.ComponentProps<'a'>) => createElement('a', { href, ...props }, children),
}))
setupUi()
beforeEach(() => {
  vi.clearAllMocks()
  mocks.invite.mockReset().mockResolvedValue({ ok: false, code: 'SEAT_LIMIT_EXCEEDED' })
  mocks.accept.mockReset().mockResolvedValue({ ok: false, code: 'SEAT_LIMIT_EXCEEDED' })
  mocks.send.mockReset().mockResolvedValue({ ok: false, code: 'INVITATION_QUOTA_EXCEEDED' })
  mocks.approve.mockReset().mockResolvedValue({ ok: false, code: 'JOB_POST_LIMIT_EXCEEDED' })
})
const initialData: JobFormData = {
  jobId: 'synthetic-job', title: 'Synthetic retained title', type: 'INTERNSHIP',
  description: 'Synthetic retained description', workMode: 'ONSITE', salaryVisible: true,
  languages: ['English'], skills: ['Research'], acceptsStudentPass: false, sponsorsWorkPass: false,
  updatedAt: '2026-11-10T01:00:00.000Z',
}
const jobs = [{ id: 'job-a', title: 'Synthetic role A' }, { id: 'job-b', title: 'Synthetic role B' }]
function assertAdvice(locale: Locale, canPurchase: boolean) {
  const t = messages(locale).entitlements
  const notice = document.querySelector('[data-testid="entitlement-limit-notice"]')
  expect(notice).not.toBeNull()
  if (canPurchase) {
    expect(notice?.querySelector('a[href="/' + locale + '/pricing"]')?.textContent).toBe(t.viewPlans)
  } else {
    expect(notice?.textContent).toContain(t.contactOwner)
    expect(notice?.querySelector('a')).toBeNull()
  }
  expect(document.body.innerHTML).not.toContain('PRIVATE_SERVER_DETAIL')
}

for (const locale of ['zh', 'en'] as const) {
  describe(locale + ' quota errors preserve the attempted action', () => {
    const t = messages(locale)
    it.each([true, false])('preserves job input/version and draft actions after publishing exceeds quota (canPurchase=%s)', async (canPurchase) => {
      const save = vi.fn().mockResolvedValueOnce({ ok: false, code: 'JOB_POST_LIMIT_EXCEEDED', message: 'PRIVATE_SERVER_DETAIL' })
        .mockResolvedValueOnce({ ok: true, data: { id: initialData.jobId, status: 'DRAFT', updatedAt: '2026-11-10T01:01:00.000Z' } })
      const props = { mode: 'edit' as const, isVerified: true, initialData, onSaveOrSubmit: save, backHref: '/e/jobs', t: jobLabels(locale), canPurchase }
      await mount(locale, createElement(JobFormClient, props))
      await click(button(t.jobs.form.submitReview))
      expect(document.querySelector('[role="alert"]')?.textContent).toContain(t.entitlements.jobsLimit)
      assertAdvice(locale, canPurchase)
      expect(document.querySelector<HTMLInputElement>('input[type="text"]')?.value).toBe(initialData.title)
      expect(document.querySelector<HTMLTextAreaElement>('textarea')?.value).toBe(initialData.description)
      expect(button(t.jobs.form.saveDraft).disabled).toBe(false)
      expect(mocks.push).not.toHaveBeenCalled()
      await click(button(t.jobs.form.saveDraft))
      expect(save.mock.calls[1][0]).toMatchObject({ title: initialData.title, description: initialData.description, updatedAt: initialData.updatedAt, submit: false })
      expect(save.mock.calls[1][0]).not.toHaveProperty('limit')
      expect(document.querySelector('[data-testid="entitlement-limit-notice"]')).toBeNull()
    })

    it.each(['FORBIDDEN', 'VALIDATION_ERROR'] as const)('does not present an unrelated job %s failure as a plan limit', async (code) => {
      const save = vi.fn().mockResolvedValue({ ok: false, code })
      const props = { mode: 'edit' as const, isVerified: true, initialData, onSaveOrSubmit: save, backHref: '/e/jobs', t: jobLabels(locale), canPurchase: true }
      await mount(locale, createElement(JobFormClient, props))
      await click(button(t.jobs.form.submitReview))
      expect(save).toHaveBeenCalledOnce()
      expect(document.querySelector('[data-testid="entitlement-limit-notice"]')).toBeNull()
      expect(document.body.textContent).not.toContain(t.entitlements.jobsLimit)
    })

    it.each(['OWNER', 'ADMIN'] as const)('preserves the team invite fields and differentiates quota guidance for %s', async (currentRole) => {
      const props = { members: [], currentUserId: 'synthetic-user', currentRole, t: t.team, canPurchase: currentRole === 'OWNER' }
      await mount(locale, createElement(TeamPageClient, props))
      const email = document.querySelector<HTMLInputElement>('input[type="email"]')!
      const role = document.querySelector<HTMLSelectElement>('#invite-role')!
      await fill(email, 'synthetic-invitee@example.test'); await select(role, 'ADMIN')
      await submit(document.querySelector('form')!)
      expect(document.querySelector('[role="alert"]')?.textContent).toContain(t.entitlements.seatsLimit)
      expect(email.value).toBe('synthetic-invitee@example.test')
      expect(role.value).toBe('ADMIN')
      expect(mocks.invite).toHaveBeenCalledExactlyOnceWith({ email: 'synthetic-invitee@example.test', role: 'ADMIN' })
      assertAdvice(locale, currentRole === 'OWNER')
    })

    it('does not relabel every team validation failure as a seat limit', async () => {
      mocks.invite.mockResolvedValueOnce({ ok: false, code: 'VALIDATION_ERROR' })
      const props = { members: [], currentUserId: 'synthetic-user', currentRole: 'OWNER' as const, t: t.team, canPurchase: true }
      await mount(locale, createElement(TeamPageClient, props))
      await fill(document.querySelector<HTMLInputElement>('input[type="email"]')!, 'synthetic-invitee@example.test')
      await submit(document.querySelector('form')!)
      expect(document.body.textContent).toContain(t.team.errorUnknown)
      expect(document.body.textContent).not.toContain(t.team.errorLimitReached)
      expect(document.querySelector('[data-testid="entitlement-limit-notice"]')).toBeNull()
    })

    it('keeps a not-yet-member invitee on the same invitation and directs them to the owner', async () => {
      await mount(locale, createElement(AcceptInviteClient, { token: 'synthetic-token', companyName: 'Synthetic company', role: 'RECRUITER', locale, t: t.teamAccept }))
      await click(button(t.teamAccept.acceptButton))
      expect(document.querySelector('[role="alert"]')?.textContent).toContain(t.entitlements.seatsLimit)
      assertAdvice(locale, false)
      expect(mocks.accept).toHaveBeenCalledExactlyOnceWith({ token: 'synthetic-token' })
      expect(mocks.push).not.toHaveBeenCalled()
      expect(button(t.teamAccept.acceptButton).disabled).toBe(false)
      expect(document.body.textContent).not.toContain(t.teamAccept.successMessage)
    })

    it('renders unlimited monthly invitations using words and keeps a selected job', async () => {
      const props = { studentId: 'synthetic-student', jobs, usedQuota: 51, totalQuota: null, canPurchase: false, open: true, onClose: vi.fn() }
      await mount(locale, createElement(InviteDialog, props))
      expect(document.querySelector('[role="dialog"]')?.textContent).toContain(t.invitations.inviteDialogQuotaUnlimited.replace('{used}', '51'))
      expect(document.querySelector('[role="dialog"]')?.textContent).not.toMatch(/NaN|Infinity|51\s*\/\s*0/)
      expect(button(t.invitations.inviteDialogSubmit).disabled).toBe(false)
      expect(mocks.send).not.toHaveBeenCalled()
    })

    it('passes nullable quota and owner guidance through the talent-page invitation trigger', async () => {
      const props = { studentId: 'synthetic-student', jobs, usedQuota: 51, totalQuota: null, canPurchase: true }
      await mount(locale, createElement(InviteButton, props))
      await click(button(t.invitations.inviteButton))
      expect(document.querySelector('[role="dialog"]')?.textContent).toContain(t.invitations.inviteDialogQuotaUnlimited.replace('{used}', '51'))
      await click(button(t.invitations.inviteDialogSubmit))
      assertAdvice(locale, true)
      expect(mocks.send).toHaveBeenCalledExactlyOnceWith({ studentId: 'synthetic-student', jobId: 'job-a', message: null })
    })

    it.each([true, false])('preserves invitation message/job and receives the authoritative quota error (canPurchase=%s)', async (canPurchase) => {
      const onClose = vi.fn()
      // A stale display says capacity remains. The service response is final.
      const props = { studentId: 'synthetic-student', jobs, usedQuota: 1, totalQuota: 20, canPurchase, open: true, onClose }
      await mount(locale, createElement(InviteDialog, props))
      const job = document.querySelector<HTMLSelectElement>('#invite-job')!
      const message = document.querySelector<HTMLTextAreaElement>('#invite-message')!
      await select(job, 'job-b'); await fill(message, 'Synthetic message to keep')
      await click(button(t.invitations.inviteDialogSubmit))
      expect(document.querySelector('[role="alert"]')?.textContent).toContain(t.entitlements.invitationsLimit)
      assertAdvice(locale, canPurchase)
      expect(job.value).toBe('job-b'); expect(message.value).toBe('Synthetic message to keep')
      expect(mocks.send).toHaveBeenCalledExactlyOnceWith({ studentId: 'synthetic-student', jobId: 'job-b', message: 'Synthetic message to keep' })
      expect(onClose).not.toHaveBeenCalled(); expect(mocks.refresh).not.toHaveBeenCalled()
    })

    it('distinguishes a duplicate application from a monthly invitation limit', async () => {
      mocks.send.mockResolvedValueOnce({ ok: false, code: 'DUPLICATE_APPLICATION' })
      const props = { studentId: 'synthetic-student', jobs, usedQuota: 1, totalQuota: 20, canPurchase: true, open: true, onClose: vi.fn() }
      await mount(locale, createElement(InviteDialog, props)); await click(button(t.invitations.inviteDialogSubmit))
      expect(document.body.textContent).toContain(t.invitations.inviteAlreadyApplied)
      expect(document.querySelector('[data-testid="entitlement-limit-notice"]')).toBeNull()
    })

    it('keeps admin review in place when the company has no publication capacity', async () => {
      await mount(locale, createElement(ReviewJobForm, { jobId: 'synthetic-review-job', updatedAt: initialData.updatedAt! }))
      await fill(document.querySelector<HTMLTextAreaElement>('#reject-note')!, 'Synthetic review note to keep')
      await click(button(t.adminJobs.approveSubmit))
      expect(document.querySelector('[role="alert"]')?.textContent).toContain(t.entitlements.reviewJobLimit)
      expect(document.querySelector<HTMLTextAreaElement>('#reject-note')?.value).toBe('Synthetic review note to keep')
      expect(mocks.approve).toHaveBeenCalledExactlyOnceWith({ jobId: 'synthetic-review-job', updatedAt: initialData.updatedAt })
      expect(mocks.push).not.toHaveBeenCalled(); expect(mocks.refresh).not.toHaveBeenCalled()
      expect(document.querySelector('a[href*="/pricing"],a[href*="/e/billing"]')).toBeNull()
    })
  })
}
