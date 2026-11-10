import { test, expect, type Page } from '@playwright/test'
import { e2eDb as db } from './helpers/db'
import { JdBrowserFixture, editedJd, generatedJd, jdCopy, jdEvidence, pressTabInsideDialog } from './helpers/jd-assistant-t02-browser'

test.use({ storageState: { cookies: [], origins: [] }, trace: 'off', screenshot: 'off', video: 'off' })

function nextActionResponse(page: Page) {
  const pathname = new URL(page.url()).pathname
  return page.waitForResponse(response => response.request().method() === 'POST' &&
    Boolean(response.request().headers()['next-action']) && new URL(response.url()).pathname === pathname)
}

test.describe('T02 real browser/action/service/official SDK with synthetic HTTP only', () => {
  test.setTimeout(240_000)

  for (const locale of ['zh', 'en'] as const) {
    test(locale + ': edit bilingual suggestions, cancel replacement, apply locally, then explicitly save a draft', async ({ page }, info) => {
      expect(test.info().config.workers).toBe(1)
      const fixture = new JdBrowserFixture(page)
      try {
        await fixture.init()
        const job = await fixture.createManualDraft(locale)
        const copy = jdCopy(locale), t = copy.jdAssistant
        const before = await fixture.state()
        const requestId = await fixture.plan()
        // Radix marks the outer editor aria-hidden while the modal is open; this locator only observes its value then.
        const description = page.getByRole('textbox', { name: copy.jobs.form.descriptionLabel, exact: true, includeHidden: true })
        const trigger = page.getByRole('button', { name: t.trigger, exact: true })
        await trigger.focus()
        await trigger.press('Enter')
        const dialog = page.getByTestId('jd-assistant-dialog')
        const points = dialog.getByRole('textbox', { name: t.points, exact: true })
        await expect(points).toBeFocused()
        await pressTabInsideDialog(page)
        await points.fill(fixture.points)
        await dialog.getByRole('checkbox', { name: t.acknowledged, exact: true }).check()
        const generationResponse = nextActionResponse(page)
        await dialog.getByRole('button', { name: t.generate, exact: true }).click()
        expect((await generationResponse).status()).toBe(200)
        await fixture.received(requestId)
        await fixture.completed(requestId)
        await expect(dialog.getByRole('textbox', { name: t.zhLabel, exact: true })).toHaveValue(generatedJd.zh)
        await expect(dialog.getByRole('textbox', { name: t.enLabel, exact: true })).toHaveValue(generatedJd.en)
        await expect(dialog.getByRole('checkbox', { name: t.acknowledged, exact: true })).not.toBeChecked()
        await expect(description).toHaveValue(fixture.originalDescription)
        expect(await fixture.state()).toEqual(before)

        await dialog.getByRole('textbox', { name: t.zhLabel, exact: true }).fill(editedJd.zh)
        await dialog.getByRole('textbox', { name: t.enLabel, exact: true }).fill(editedJd.en)
        await jdEvidence(page, info, locale + '-editable-bilingual-suggestions')
        await dialog.getByRole('button', { name: t.apply, exact: true }).click()
        await expect(page.getByRole('dialog', { name: t.replaceTitle, exact: true })).toBeVisible()
        await expect(dialog.getByTestId('jd-replace-current')).toHaveText(fixture.originalDescription)
        await jdEvidence(page, info, locale + '-replacement-confirmation')
        await dialog.getByRole('button', { name: t.keepEditing, exact: true }).click()
        await expect(dialog.getByRole('textbox', { name: t.enLabel, exact: true })).toHaveValue(editedJd.en)
        await expect(description).toHaveValue(fixture.originalDescription)
        expect(await fixture.state()).toEqual(before)

        await dialog.getByRole('button', { name: t.apply, exact: true }).click()
        await dialog.getByRole('button', { name: t.replace, exact: true }).click()
        const combined = t.zhHeading + '\n' + editedJd.zh + '\n\n' + t.enHeading + '\n' + editedJd.en
        await expect(dialog).not.toBeVisible()
        await expect(page.getByTestId('jd-assistant-feedback')).toHaveText(t.applied)
        await expect(description).toHaveValue(combined)
        await expect(description).toBeFocused()
        // Even after explicit Apply, Job/Job audit/ApplicationEvent/wallet/ledger/notification/consent are unchanged.
        expect(await fixture.state()).toEqual(before)

        const saveResponse = nextActionResponse(page)
        await page.getByRole('button', { name: copy.jobs.form.saveDraft, exact: true }).click()
        expect((await saveResponse).status()).toBe(200)
        await expect(page.getByText(copy.jobs.form.saveSuccess, { exact: true })).toBeVisible()
        // Success precedes router.refresh; finish its RSC request before reload/navigation.
        await page.waitForLoadState('networkidle')
        await expect.poll(async () => (await db.job.findUniqueOrThrow({ where: { id: job.id } })).description).toBe(combined)
        const after = await fixture.state()
        expect(after.jobs).toHaveLength(1)
        const { description: originalText, updatedAt: originalRevision, ...originalFields } = before.jobs[0]!
        const { description: savedText, updatedAt: savedRevision, ...savedFields } = after.jobs[0]!
        expect(originalText).toBe(fixture.originalDescription)
        expect(savedText).toBe(combined)
        expect(savedRevision.getTime()).toBeGreaterThan(originalRevision.getTime())
        expect(savedFields).toEqual(originalFields)
        expect(savedFields.status).toBe('DRAFT')
        // Ordinary draft saving may record its own events; the no-side-effect assertions above apply to generation/application.
        expect(after.totalJobs).toBe(before.totalJobs)
        await page.reload()
        await page.waitForLoadState('networkidle')
        await expect(description).toHaveValue(combined)
        await expect(page.getByRole('button', { name: copy.jobs.form.submitReview, exact: true })).toHaveCount(0)
        const events = await fixture.events()
        expect(events.filter(event => event.requestId === requestId && event.event === 'accepted')).toHaveLength(1)
        expect(events.filter(event => event.requestId === requestId && event.event === 'returned')).toHaveLength(1)
      } finally { await fixture.cleanup(info) }
    })
  }

  test('closing a pending dialog returns focus and discards a real late server response after reopening', async ({ page }, info) => {
    expect(test.info().config.workers).toBe(1)
    const fixture = new JdBrowserFixture(page)
    try {
      await fixture.init()
      await fixture.createManualDraft('en')
      const copy = jdCopy('en'), t = copy.jdAssistant
      const before = await fixture.state()
      const requestId = await fixture.plan(true)
      const trigger = page.getByRole('button', { name: t.trigger, exact: true })
      await trigger.click()
      const dialog = page.getByTestId('jd-assistant-dialog')
      await dialog.getByRole('textbox', { name: t.points, exact: true }).fill(fixture.points)
      await dialog.getByRole('checkbox', { name: t.acknowledged, exact: true }).check()
      const generationResponse = nextActionResponse(page)
      await dialog.getByRole('button', { name: t.generate, exact: true }).click()
      await fixture.received(requestId)
      await expect(dialog.getByRole('button', { name: t.generating, exact: true })).toBeDisabled()
      await page.keyboard.press('Escape')
      await expect(dialog).not.toBeVisible()
      await expect(trigger).toBeFocused()
      await trigger.press('Enter')
      await expect(dialog.getByRole('textbox', { name: t.points, exact: true })).toBeFocused()
      await fixture.release(requestId)
      expect((await generationResponse).status()).toBe(200)
      await fixture.completed(requestId)
      await page.waitForLoadState('networkidle')
      await expect(dialog.getByRole('textbox', { name: t.enLabel, exact: true })).toHaveCount(0)
      await expect(dialog.getByRole('textbox', { name: t.zhLabel, exact: true })).toHaveCount(0)
      await expect(dialog.getByRole('checkbox', { name: t.acknowledged, exact: true })).not.toBeChecked()
      await expect(page.getByRole('textbox', { name: copy.jobs.form.descriptionLabel, exact: true, includeHidden: true })).toHaveValue(fixture.originalDescription)
      expect(await fixture.state()).toEqual(before)
      await dialog.getByRole('button', { name: t.cancel, exact: true }).click()
      await expect(trigger).toBeFocused()
    } finally { await fixture.cleanup(info) }
  })
})
