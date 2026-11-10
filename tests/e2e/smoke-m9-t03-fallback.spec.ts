import { test, expect } from '@playwright/test'
import { e2eDb as db } from './helpers/db'
import { evidence } from './helpers/billing-t02-ui'
import { MatchingFixture, matchingCopy } from './helpers/matching-t03-ui'
test.use({ storageState: { cookies: [], origins: [] }, trace: 'off', video: 'off', screenshot: 'off' })
test.describe('T03 ordinary PostgreSQL fallback', () => {
  test.setTimeout(180_000)
  let fixture: MatchingFixture
  test.beforeEach(async ({ page, browser }) => { fixture = new MatchingFixture(page, browser); await fixture.init(false) })
  test.afterEach(async () => { if (fixture) await fixture.cleanup() })
  for (const locale of ['zh', 'en'] as const) {
    test(locale + ': missing vector capability preserves search and allows real withdrawal without inference', async ({ page }, info) => {
      const t = matchingCopy(locale).matching
      await fixture.seedConsent()
      const before = await fixture.counts(), profile = await db.studentProfile.findUniqueOrThrow({ where: { id: fixture.profileId } })
      await page.goto('/' + locale + '/s')
      const panel = page.getByTestId('student-matching-panel')
      await expect(panel.getByText(t.unavailable, { exact: true })).toBeVisible()
      await expect(panel.getByRole('button', { name: t.requestJobs, exact: true })).toBeDisabled()
      await expect(panel.getByRole('link', { name: t.searchJobs, exact: true })).toHaveAttribute('href', '/' + locale + '/jobs')
      const employer = fixture.employerPage
      await employer.goto('/' + locale + '/e/jobs/' + fixture.jobId + '/recommendations')
      const employerPanel = employer.getByTestId('employer-matching-panel')
      await employerPanel.getByRole('button', { name: t.requestTalent, exact: true }).click()
      await expect(employerPanel.getByText(t.unavailable, { exact: true })).toBeVisible()
      await expect(employerPanel.getByRole('link', { name: t.searchTalent, exact: true })).toHaveAttribute('href', '/' + locale + '/e/talent')
      expect(await fixture.counts()).toEqual(before); expect(fixture.log()).toEqual([])
      await fixture.gate(false); await page.reload()
      await panel.getByRole('button', { name: t.withdraw, exact: true }).click()
      await expect(panel.getByText(t.consentWithdrawn, { exact: true })).toBeVisible()
      expect(await db.studentProfile.findUniqueOrThrow({ where: { id: fixture.profileId } })).toEqual(profile)
      const latest = await db.consent.findFirstOrThrow({ where: { userId: fixture.studentUserId, type: 'AI_MATCHING' }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] })
      expect(latest.granted).toBe(false)
      expect(fixture.log()).toEqual([])
      await evidence(page, info, locale + '-missing-store-withdrawal', '[data-testid="student-matching-panel"]')
      await evidence(employer, info, locale + '-missing-store-employer', '[data-testid="employer-matching-panel"]')
    })
  }
})
