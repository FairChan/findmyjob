import { test, expect } from '@playwright/test'
import { e2eDb as db } from './helpers/db'
import { evidence } from './helpers/billing-t02-ui'
import { MatchingFixture, matchingCopy, watchMatchingResponses } from './helpers/matching-t03-ui'

test.use({ storageState: { cookies: [], origins: [] }, trace: 'off', video: 'off', screenshot: 'off' })
test.describe('T03 real matching UI with synthetic transport and pgvector', () => {
  test.setTimeout(240_000)
  let fixture: MatchingFixture
  test.beforeEach(async ({ page, browser }) => {
    expect(test.info().config.workers).toBe(1)
    fixture = new MatchingFixture(page, browser); await fixture.init(true)
  })
  test.afterEach(async () => { if (fixture) await fixture.cleanup() })
  for (const locale of ['zh', 'en'] as const) {
    test(locale + ': independent consent, real retrieval, no prefetch, existing detail quotas and withdrawal', async ({ page }, info) => {
      const t = matchingCopy(locale).matching
      const before = await fixture.counts(), calls = fixture.log().length
      const initial = await db.studentProfile.findUniqueOrThrow({ where: { id: fixture.profileId } })
      await fixture.seedIndex('JOB')
      await page.goto('/' + locale + '/s')
      const studentPanel = page.getByTestId('student-matching-panel')
      await expect(studentPanel.getByLabel(t.consentLabel, { exact: true })).not.toBeChecked()
      await expect(studentPanel.getByRole('button', { name: t.requestJobs, exact: true })).toBeDisabled()
      expect(fixture.log()).toHaveLength(calls)
      await studentPanel.getByLabel(t.consentLabel, { exact: true }).check()
      await studentPanel.getByRole('button', { name: t.saveConsent, exact: true }).click()
      await expect(studentPanel.getByText(t.consentSaved, { exact: true })).toBeVisible()
      expect(await db.studentProfile.findUniqueOrThrow({ where: { id: fixture.profileId } })).toEqual(initial)
      expect(await db.consent.count({ where: { userId: fixture.studentUserId, type: 'TALENT_POOL' } })).toBe(0)
      expect(fixture.log()).toHaveLength(calls)
      const jobRequests: string[] = []
      const checkStudentPayload = await watchMatchingResponses(page)
      page.on('request', request => { if (new URL(request.url()).pathname === '/' + locale + '/jobs/' + fixture.jobId) jobRequests.push('detail') })
      await studentPanel.getByRole('button', { name: t.requestJobs, exact: true }).click()
      await expect(studentPanel.getByText(t.loaded, { exact: true })).toBeVisible()
      const jobLink = studentPanel.locator('a[href="/' + locale + '/jobs/' + fixture.jobId + '"]')
      await expect(jobLink).toBeVisible(); await jobLink.hover()
      await evidence(page, info, locale + '-job-recommendations', '[data-testid="student-matching-panel"]')
      await page.waitForLoadState('networkidle')
      expect(jobRequests).toEqual([]); expect(await fixture.counts()).toEqual(before)
      expect(await page.content()).not.toContain(fixture.privateBody)
      expect(await studentPanel.textContent()).not.toMatch(/12345|23456/)
      expect(fixture.log()).toHaveLength(calls + 1)
      await checkStudentPayload([fixture.privateBody, '12345', '23456'])
      await jobLink.click()
      await expect.poll(async () => (await fixture.counts()).jobs).toBe(before.jobs + 1)
      expect(await page.content()).toContain(fixture.privateBody)
      expect((await fixture.counts()).unlocks).toBe(before.unlocks)

      // Talent-pool visibility is changed only by its original, separate control.
      await page.goto('/' + locale + '/s/privacy')
      const consentPanel = page.getByTestId('matching-consent-panel')
      await expect(consentPanel.getByRole('button', { name: t.withdraw, exact: true })).toBeVisible()
      await expect(page.locator('#talent-pool-toggle')).toHaveAttribute('aria-checked', 'false')
      await page.locator('#talent-pool-toggle').click()
      await expect.poll(async () => (await db.studentProfile.findUniqueOrThrow({ where: { id: fixture.profileId } })).visibility).toBe('PUBLIC')
      const index = await fixture.seedIndex('STUDENT')

      const employer = fixture.employerPage
      await employer.goto('/' + locale + '/e/jobs')
      const entry = employer.locator('a[href="/' + locale + '/e/jobs/' + fixture.jobId + '/recommendations"]')
      await expect(entry).toBeVisible(); await entry.click()
      const employerPanel = employer.getByTestId('employer-matching-panel')
      await expect(employerPanel.getByRole('button', { name: t.requestTalent, exact: true })).toBeVisible()
      const profileRequests: string[] = []
      const checkEmployerPayload = await watchMatchingResponses(employer)
      employer.on('request', request => { if (new URL(request.url()).pathname === '/' + locale + '/e/talent/' + fixture.profileId) profileRequests.push('detail') })
      const beforeTalent = await fixture.counts()
      const bucketKey = 'talent-search-pages:' + fixture.employerUserId
      const rateBefore = (await db.rateLimitBucket.aggregate({ where: { key: bucketKey }, _sum: { count: true } }))._sum.count ?? 0
      await employerPanel.getByRole('button', { name: t.requestTalent, exact: true }).click()
      await expect(employerPanel.getByText(t.loaded, { exact: true })).toBeVisible()
      const talentLink = employerPanel.locator('a[href="/' + locale + '/e/talent/' + fixture.profileId + '"]')
      await expect(talentLink).toBeVisible(); await talentLink.hover()
      await evidence(employer, info, locale + '-talent-recommendations', '[data-testid="employer-matching-panel"]')
      await employer.waitForLoadState('networkidle')
      expect(profileRequests).toEqual([]); expect(await fixture.counts()).toEqual(beforeTalent)
      expect(await employer.content()).not.toContain(fixture.fullName)
      expect(await employer.content()).not.toContain('SYNTHETIC_PRIVATE_PROFILE_BODY')
      await checkEmployerPayload([fixture.fullName, 'SYNTHETIC_PRIVATE_PROFILE_BODY'])
      expect((await db.rateLimitBucket.aggregate({ where: { key: bucketKey }, _sum: { count: true } }))._sum.count).toBe(rateBefore + 1)
      await talentLink.click()
      await expect.poll(async () => (await fixture.counts()).profiles).toBe(beforeTalent.profiles + 1)
      expect((await fixture.counts()).unlocks).toBe(before.unlocks)
      expect((await fixture.counts()).credits).toBe(before.credits)

      for (const blockedId of [fixture.draftId, fixture.foreignId]) {
        await employer.goto('/' + locale + '/e/jobs/' + blockedId + '/recommendations')
        await expect(employer.getByRole('heading', { name: '404', exact: true })).toBeVisible()
        await expect(employer.getByTestId('employer-matching-panel')).toHaveCount(0)
      }
      const afterDetails = await fixture.counts(), callsBeforeWithdraw = fixture.log().length
      await fixture.gate(false)
      await page.goto('/' + locale + '/s/privacy')
      await expect(consentPanel.getByText(t.unavailable, { exact: true })).toBeVisible()
      await consentPanel.getByRole('button', { name: t.withdraw, exact: true }).click()
      await expect(consentPanel.getByText(t.consentWithdrawn, { exact: true })).toBeVisible()
      expect(await db.semanticIndex.findUniqueOrThrow({ where: { id: index.id } })).toMatchObject({ state: 'CANCELLED', generation: 2 })
      const latest = await db.consent.findFirstOrThrow({ where: { userId: fixture.studentUserId, type: 'AI_MATCHING' }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] })
      expect(latest.granted).toBe(false)
      expect((await db.studentProfile.findUniqueOrThrow({ where: { id: fixture.profileId } })).visibility).toBe('PUBLIC')
      expect(await fixture.counts()).toEqual(afterDetails); expect(fixture.log()).toHaveLength(callsBeforeWithdraw)
      await evidence(page, info, locale + '-disabled-withdrawal', '[data-testid="matching-consent-panel"]')
      await page.goto('/' + locale + '/s')
      await expect(studentPanel.getByRole('link', { name: t.searchJobs, exact: true })).toBeVisible()
      await expect(studentPanel.getByRole('button', { name: t.requestJobs, exact: true })).toBeDisabled()
    })
  }
})
