// @vitest-environment jsdom
/** Report-only T04 UI contract. Add the compilable summary baseline/messages
 * before behavior RED. This suite does not prove service authorization or quotas. */
import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { CompanyEntitlementSummary } from '@/components/billing/company-entitlement-summary'
import { setupUi, mount, usage, messages } from '../helpers/entitlements-ui-t04'

setupUi()
for (const locale of ['zh', 'en'] as const) {
  describe(locale + ' current entitlement summary', () => {
    const t = messages(locale).entitlements
    it.each(['jobs', 'seats', 'invitations'] as const)('shows actual over-limit %s use and retained-resource guidance', async (resource) => {
      const value = usage()
      await mount(locale, createElement(CompanyEntitlementSummary, { usage: value, resource }))
      const view = document.querySelector('[data-testid="entitlement-usage"]')
      expect(view?.textContent).toContain(t[resource])
      expect(view?.textContent).toContain(t.finiteUsage.replace('{used}', String(value[resource].used)).replace('{limit}', String(value[resource].limit)))
      expect(view?.textContent).toContain(t[resource === 'jobs' ? 'jobsRetained' : resource === 'seats' ? 'seatsRetained' : 'invitationsRetained'])
      expect(view?.textContent?.includes(t.reservedSeats.replace('{reserved}', '2'))).toBe(resource === 'seats')
      expect(document.querySelector('a[href="/' + locale + '/pricing"]')).not.toBeNull()
      expect(document.querySelector('a[href="/' + locale + '/e/billing"]')?.textContent).toBe(t.manageBilling)
    })

    it('preserves explicit unlimited and zero limits without clamping or dividing them', async () => {
      await mount(locale, createElement(CompanyEntitlementSummary, { resource: 'invitations', usage: usage({ invitations: { used: 51, limit: null } }) }))
      expect(document.body.textContent).toContain(t.unlimitedUsage.replace('{used}', '51'))
      expect(document.body.textContent).not.toMatch(/NaN|Infinity|51\s*\/\s*0/)
      await mount(locale, createElement(CompanyEntitlementSummary, { resource: 'invitations', usage: usage({ invitations: { used: 0, limit: 0 } }) }))
      expect(document.body.textContent).toContain(t.finiteUsage.replace('{used}', '0').replace('{limit}', '0'))
      expect(document.body.textContent).not.toContain(t.unlimitedUsage.replace('{used}', '0'))
    })

    it('keeps paid limits visible after sales close and omits purchase links', async () => {
      const value = usage({ source: 'SUBSCRIPTION', effectiveUntil: '2027-01-15T00:00:00.000Z', canPurchase: false, jobs: { used: 4, limit: 10 } })
      await mount(locale, createElement(CompanyEntitlementSummary, { resource: 'jobs', usage: value }))
      expect(document.body.textContent).toContain(t.sourceSubscription)
      expect(document.body.textContent).toContain(t.finiteUsage.replace('{used}', '4').replace('{limit}', '10'))
      expect(document.querySelector('time')?.dateTime).toBe(value.effectiveUntil)
      expect(document.querySelector('a[href*="/pricing"],a[href*="/e/billing"]')).toBeNull()
    })

    it('shows pilot allowances without commercial purchase guidance or internal IDs', async () => {
      const value = { ...usage({ source: 'PILOT', canPurchase: false, jobs: { used: 7, limit: null } }), orderId: 'PRIVATE_ORDER', snapshot: { token: 'PRIVATE_SNAPSHOT' } }
      await mount(locale, createElement(CompanyEntitlementSummary, { resource: 'jobs', usage: value }))
      expect(document.body.textContent).toContain(t.sourcePilot)
      expect(document.body.textContent).toContain(t.unlimitedUsage.replace('{used}', '7'))
      expect(document.querySelector('a')).toBeNull()
      expect(document.body.innerHTML).not.toMatch(/PRIVATE_ORDER|PRIVATE_SNAPSHOT/)
    })
  })
}
