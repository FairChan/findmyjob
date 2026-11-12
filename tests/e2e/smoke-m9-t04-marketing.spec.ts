import { test, expect } from '@playwright/test'
import { e2eDb as db } from './helpers/db'
import { MarketingBrowserFixture, marketingCopy, marketingEvidence, nextMarketingAction } from './helpers/marketing-t04-browser'

test.use({ storageState: { cookies: [], origins: [] }, trace: 'off', screenshot: 'off', video: 'off' })
test.describe('T04 default-off preference and anonymous withdrawal', () => {
  test.setTimeout(240_000)

  for (const locale of ['zh', 'en'] as const) for (const role of ['STUDENT', 'EMPLOYER'] as const) {
    test(locale + ' ' + role + ': default-off, stale-legal withdrawal and independent consent', async ({ page }, info) => {
      const fixture = new MarketingBrowserFixture(page)
      try {
        expect(info.config.workers).toBe(1)
        await fixture.init(role)
        const path = '/' + locale + (role === 'STUDENT' ? '/s/privacy' : '/e/preferences')
        const copy = marketingCopy(locale), t = copy.marketing
        const beforeGet = await fixture.state()
        expect((await page.goto(path))?.status()).toBe(200)
        await page.waitForLoadState('networkidle')
        const panel = page.getByTestId('marketing-preferences')
        const checkbox = panel.getByRole('checkbox', { name: t.consentLabel, exact: true })
        const save = panel.getByRole('button', { name: t.save, exact: true })
        await expect(checkbox).not.toBeChecked(); await expect(checkbox).toBeDisabled()
        await expect(save).toBeDisabled()
        await expect(panel.getByText(t.unavailable, { exact: true })).toBeVisible()
        await expect(panel.getByRole('button', { name: t.withdraw, exact: true })).toHaveCount(0)
        expect(await fixture.state()).toEqual(beforeGet)
        await marketingEvidence(page, info, locale + '-' + role + '-default-off')

        await fixture.seedHistoricalChoice()
        const before = await fixture.state()
        expect((await page.reload())?.status()).toBe(200)
        await page.waitForLoadState('networkidle')
        expect(new URL(page.url()).pathname).toBe(path)
        if (role === 'EMPLOYER') expect(await db.companyMember.count({ where: { userId: fixture.userId } })).toBe(0)
        const withdraw = panel.getByRole('button', { name: t.withdraw, exact: true })
        await expect(withdraw).toBeEnabled()
        await expect(checkbox).not.toBeChecked(); await expect(checkbox).toBeDisabled()
        await expect(page.getByRole('dialog')).toHaveCount(0)
        expect(await fixture.state()).toEqual(before)

        if (role === 'STUDENT') {
          const visibility = page.getByRole('switch', { name: copy.privacy.visibilityOff, exact: true })
          await expect(visibility).not.toBeChecked()
          await visibility.focus()
          // Start reading on the response event, before the keyboard action
          // finishes; Chromium may release a streamed response during navigation.
          const response = nextMarketingAction(page).then(async result => ({
            status: result.status(), body: await result.text(),
          }))
          await visibility.press('Enter')
          const rejected = await response
          expect(rejected.status).toBe(200)
          expect(rejected.body).toMatch(/"code"\s*:\s*"FORBIDDEN"/)
          await expect(page.getByRole('alert').filter({ hasText: copy.privacy.errorGeneric })).toBeVisible()
          await expect(visibility).not.toBeChecked()
          await expect(visibility).toBeEnabled()
          expect(await fixture.state()).toEqual(before)
        }
        // Native keyboard sequence reaches withdrawal and skips disabled opt-in controls.
        await panel.getByRole('link', { name: t.privacyPolicy, exact: true }).focus()
        await page.keyboard.press('Tab')
        await expect(withdraw).toBeFocused()
        await marketingEvidence(page, info, locale + '-' + role + '-historical-withdrawal')
        const response = nextMarketingAction(page)
        await withdraw.press('Enter')
        expect((await response).status()).toBe(200)
        const status = panel.getByRole('status')
        await expect(status).toHaveText(t.withdrawn)
        await expect(status).toBeFocused()
        await expect(withdraw).toHaveCount(0)
        await expect(page.getByRole('dialog')).toHaveCount(0)
        await page.waitForLoadState('networkidle')
        const after = await fixture.expectWithdrawn(before)
        await marketingEvidence(page, info, locale + '-' + role + '-withdrawn')
        await page.reload(); await page.waitForLoadState('networkidle')
        await expect(withdraw).toHaveCount(0)
        expect(await fixture.state()).toEqual(after)
      } finally { await fixture.cleanup(info) }
    })
  }

  test('anonymous signed GET is inert; token-only POST withdraws once without Origin or login', async ({ page }, info) => {
    const fixture = new MarketingBrowserFixture(page)
    try {
      await fixture.init('STUDENT', true)
      await fixture.seedHistoricalChoice()
      const before = await fixture.state()
      expect(before.profile?.visibility).toBe('PUBLIC')
      expect(before.otherConsents).toEqual(expect.arrayContaining([expect.objectContaining({ type: 'TALENT_POOL', granted: true })]))
      expect(await page.context().cookies()).toEqual([])
      const token = fixture.token()
      async function openConfirmation() {
        // Reporter is line-only; replace navigation errors so they cannot print the signed URL.
        try {
          const response = await page.goto('/api/marketing/unsubscribe?token=' + encodeURIComponent(token))
          expect(response?.status()).toBe(200)
          const headers = response!.headers()
          expect(headers['cache-control']).toContain('no-store')
          expect(headers['referrer-policy']).toBe('no-referrer')
          expect(headers['x-robots-tag']).toBe('noindex, nofollow')
          expect(headers['content-security-policy']).toContain("form-action 'self'")
        } catch { throw new Error('Anonymous confirmation navigation failed; signed URL omitted') }
        await expect(page).toHaveTitle('Unsubscribe / 退订')
        await expect(page.locator('html')).toHaveAttribute('lang', 'en')
        await expect(page.getByRole('main')).toBeVisible()
        await expect(page.getByRole('heading', { level: 1 })).toHaveText('Unsubscribe / 退订')
        await expect(page.getByRole('button', { name: 'Stop weekly emails / 停止每周邮件', exact: true })).toBeFocused()
      }
      await openConfirmation()
      expect(await fixture.state()).toEqual(before)
      await marketingEvidence(page, info, 'anonymous-confirmation', true)
      const posted = page.waitForResponse(response => response.request().method() === 'POST' &&
        new URL(response.url()).pathname === '/api/marketing/unsubscribe')
      await page.getByRole('button', { name: 'Stop weekly emails / 停止每周邮件', exact: true }).press('Enter')
      expect((await posted).status()).toBe(200)
      const status = page.getByRole('status')
      await expect(status).toHaveText('Your weekly email preference has been processed. 每周邮件偏好已处理。')
      await expect(status).toBeFocused()
      const after = await fixture.expectWithdrawn(before)
      await marketingEvidence(page, info, 'anonymous-completed', true)
      await openConfirmation()
      expect(await fixture.state()).toEqual(after)
      expect(await page.context().cookies()).toEqual([])
      const repeated = page.waitForResponse(response => response.request().method() === 'POST' &&
        new URL(response.url()).pathname === '/api/marketing/unsubscribe')
      await page.getByRole('button', { name: 'Stop weekly emails / 停止每周邮件', exact: true }).press('Enter')
      expect((await repeated).status()).toBe(200)
      await expect(page.getByRole('status')).toBeFocused()
      expect(await fixture.state()).toEqual(after)
      expect(fixture.anonymousPosts).toEqual([
        { tokenOnly: true, hadCookie: false, originRemoved: true },
        { tokenOnly: true, hadCookie: false, originRemoved: true },
      ])
    } finally { await fixture.cleanup(info) }
  })
})
