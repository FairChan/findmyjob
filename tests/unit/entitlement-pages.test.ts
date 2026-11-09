// @vitest-environment jsdom
/** Report-only page wiring. Read/auth boundaries mocked; real page/component
 * tree. No claim of current membership or database enforcement. */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { createTranslator, type AbstractIntlMessages } from 'next-intl'
import JobsPage from '@/app/[locale]/e/jobs/page'
import TeamPage from '@/app/[locale]/e/team/page'
import InvitationsPage from '@/app/[locale]/e/invitations/page'
import NotificationsPage from '@/app/[locale]/e/notifications/page'
import { setupUi, mount, messages, usage } from '../helpers/entitlements-ui-t04'

const mocks = vi.hoisted(() => ({ member: vi.fn(), usage: vi.fn(), monthly: vi.fn(), notifications: vi.fn(), locale: 'en' as 'zh' | 'en' }))
vi.mock('next/headers', () => ({ headers: async () => new Headers() }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }), redirect: vi.fn() }))
vi.mock('@/i18n/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
  Link: ({ href, children, ...props }: React.ComponentProps<'a'>) => createElement('a', { href, ...props }, children),
}))
vi.mock('@/server/authz', () => ({ requireCompanyMember: mocks.member }))
vi.mock('@/server/services/subscription-entitlements', () => ({ getCompanyEntitlementUsage: mocks.usage }))
vi.mock('@/server/services/jobs', () => ({ listCompanyJobs: vi.fn().mockResolvedValue([]) }))
vi.mock('@/server/services/company', () => ({ getMyCompany: vi.fn().mockResolvedValue({ id: 'synthetic-company' }) }))
vi.mock('@/server/services/team', () => ({ listTeamMembers: vi.fn().mockResolvedValue([]) }))
vi.mock('@/server/services/invitations', () => ({ listCompanyInvitations: vi.fn().mockResolvedValue([]), getMonthlyInvitationUsage: mocks.monthly }))
vi.mock('@/server/services/notifications', () => ({ listNotifications: mocks.notifications }))
vi.mock('@/server/actions/team', () => ({ inviteMemberAction: vi.fn(), removeMemberAction: vi.fn(), changeRoleAction: vi.fn() }))
vi.mock('@/app/[locale]/e/jobs/actions', () => ({ copyJobAction: vi.fn(), closeJobAction: vi.fn() }))
vi.mock('@/components/notifications/NotificationsClient', () => ({ NotificationsClient: () => null }))
vi.mock('@/components/notifications/MarkAllReadButton', () => ({ MarkAllReadButton: () => null }))
vi.mock('next-intl/server', () => ({
  getLocale: async () => mocks.locale,
  getTranslations: async (arg: string | { locale?: string; namespace: string }) => createTranslator({
    locale: mocks.locale, messages: messages(mocks.locale) as AbstractIntlMessages,
    namespace: typeof arg === 'string' ? arg : arg.namespace,
  }),
}))
setupUi()
const ctx = { userId: 'synthetic-user', companyId: 'synthetic-company', role: 'OWNER' as const }
beforeEach(() => {
  vi.clearAllMocks()
  mocks.member.mockReset().mockResolvedValue(ctx)
  mocks.usage.mockReset().mockResolvedValue(usage())
  mocks.monthly.mockReset().mockResolvedValue({ used: 51, quota: null })
  mocks.notifications.mockReset().mockResolvedValue([])
})
for (const locale of ['zh', 'en'] as const) {
  describe(locale + ' entitlement page data boundaries', () => {
    beforeEach(() => { mocks.locale = locale })
    it.each(['jobs', 'team', 'invitations'] as const)('reads current usage for %s and preserves over-limit values', async (page) => {
      const props = { params: Promise.resolve({ locale }) }
      const tree = page === 'jobs' ? await JobsPage(props) : page === 'team' ? await TeamPage(props) : await InvitationsPage(props)
      await mount(locale, tree)
      expect(mocks.usage).toHaveBeenCalledExactlyOnceWith(ctx)
      expect(document.querySelector('[data-testid="entitlement-usage"]')).not.toBeNull()
      const value = page === 'jobs' ? { used: 5, limit: 2 } : page === 'team' ? { used: 8, limit: 3 } : { used: 50, limit: 20 }
      expect(document.body.textContent).toContain(messages(locale).entitlements.finiteUsage.replace('{used}', String(value.used)).replace('{limit}', String(value.limit)))
    })

    it('uses the same nullable invitation allowance in the page summary without legacy numeric interpolation', async () => {
      mocks.usage.mockResolvedValueOnce(usage({ invitations: { used: 51, limit: null } }))
      await mount(locale, await InvitationsPage({ params: Promise.resolve({ locale }) }))
      expect(document.body.textContent).toContain(messages(locale).entitlements.unlimitedUsage.replace('{used}', '51'))
      expect(document.body.textContent).not.toMatch(/NaN|Infinity|51\s*\/\s*0/)
      // Prefer the unified usage DTO on this page, avoiding contradictory reads.
      expect(mocks.monthly).not.toHaveBeenCalled()
    })

    it('does not give an ordinary team member billing or purchase links', async () => {
      mocks.member.mockResolvedValueOnce({ ...ctx, role: 'RECRUITER' })
      mocks.usage.mockResolvedValueOnce(usage({ canPurchase: false }))
      await mount(locale, await TeamPage({ params: Promise.resolve({ locale }) }))
      expect(document.querySelector('[data-testid="entitlement-usage"]')?.textContent).toContain(messages(locale).entitlements.seatsRetained)
      expect(document.querySelector('a[href*="/pricing"],a[href*="/e/billing"]')).toBeNull()
    })

    it('renders only safe expiry wording and a fixed local owner billing link', async () => {
      const endsAt = '2026-11-17T16:00:00.000Z'
      mocks.notifications.mockResolvedValueOnce([{
        id: 'synthetic-notification', type: 'subscription.expiring', readAt: null, createdAt: new Date('2026-11-10T00:00:00Z'),
        payload: { endsAt, subscriptionId: 'PRIVATE_SUBSCRIPTION', orderId: 'PRIVATE_ORDER', snapshot: 'PRIVATE_SNAPSHOT', href: 'https://attacker.invalid/PRIVATE_URL' },
      }])
      const tree = await NotificationsPage()
      expect(JSON.stringify(tree)).not.toMatch(/PRIVATE_SUBSCRIPTION|PRIVATE_ORDER|PRIVATE_SNAPSHOT|PRIVATE_URL/)
      await mount(locale, tree)
      expect(document.body.textContent).toContain(messages(locale).notifications.subscriptionExpiring)
      expect(document.querySelector('time[datetime="' + endsAt + '"]')).not.toBeNull()
      expect(document.querySelector('a[href="/' + locale + '/e/billing"]')?.textContent).toBe(messages(locale).notifications.subscriptionBilling)
      expect(document.querySelector('a[href^="https:"]')).toBeNull()
    })

    it('keeps a historical expiry notice readable after owner demotion without a billing link', async () => {
      mocks.member.mockResolvedValueOnce({ ...ctx, role: 'RECRUITER' })
      mocks.notifications.mockResolvedValueOnce([{
        id: 'synthetic-notification', type: 'subscription.expiring', readAt: new Date(), createdAt: new Date(),
        payload: { endsAt: '2026-11-17T16:00:00.000Z', subscriptionId: 'PRIVATE_SUBSCRIPTION' },
      }])
      await mount(locale, await NotificationsPage())
      expect(document.body.textContent).toContain(messages(locale).notifications.subscriptionExpiring)
      expect(document.querySelector('a[href*="/e/billing"]')).toBeNull()
      expect(document.body.innerHTML).not.toContain('PRIVATE_SUBSCRIPTION')
    })

    it('does not crash or print raw payload when an old expiry date is malformed', async () => {
      mocks.notifications.mockResolvedValueOnce([{
        id: 'synthetic-notification', type: 'subscription.expiring', readAt: null, createdAt: new Date(),
        payload: { endsAt: 'PRIVATE_INVALID_DATE', subscriptionId: 'PRIVATE_SUBSCRIPTION' },
      }])
      await mount(locale, await NotificationsPage())
      expect(document.body.textContent).toContain(messages(locale).notifications.subscriptionExpiring)
      expect(document.body.innerHTML).not.toMatch(/PRIVATE_INVALID_DATE|PRIVATE_SUBSCRIPTION|Invalid Date/)
    })
  })
}
