/**
 * Offline browser boundary coverage only. No successful provider request is
 * exercised here. Companion jsdom tests cover real editor/assistant interaction.
 * Run alone with --workers=1 against the guarded local test DB, gate disabled.
 */
import { randomUUID } from 'node:crypto'
import { test, expect } from '@playwright/test'
import { e2eDb as db } from './helpers/db'
import { loginAs } from './helpers/session'
import { expectPageHealthy } from './helpers/smoke'
import zh from '../../messages/zh.json'
import en from '../../messages/en.json'

test.use({ trace: 'off', screenshot: 'off', video: 'off' })
const copy = {
  zh: { jobs: zh.jobs, assistant: 'AI 职位描述助手' },
  en: { jobs: en.jobs, assistant: 'AI job description assistant' },
}

for (const locale of ['zh', 'en'] as const) {
  test(locale + ': disabled assistant preserves unverified recruiter manual draft saving and closed-job guard', async ({ page }, info) => {
    expect(test.info().config.workers).toBe(1)
    const gate = (await db.systemSetting.findUnique({ where: { key: 'ai.jdAssistant' }, select: { value: true } }))?.value
    const disabled = gate == null || (typeof gate === 'object' && !Array.isArray(gate) && gate.enabled === false)
    expect(disabled, 'This offline browser contract requires a missing or disabled JD gate').toBe(true)
    const marker = 'M9T02_UI_' + randomUUID().replaceAll('-', '')
    const actor = await loginAs(page, { role: 'EMPLOYER', company: { verificationStatus: 'UNSUBMITTED', memberRole: 'RECRUITER' } })
    const companyId = actor.companyId!
    try {
      const c = copy[locale]
      await expectPageHealthy(page, '/' + locale + '/e/jobs/new')
      await expect(page.getByRole('button', { name: c.assistant, exact: true })).toHaveCount(0)
      await expect(page.getByRole('button', { name: c.jobs.form.submitReview, exact: true })).toHaveCount(0)
      const title = page.getByPlaceholder(c.jobs.form.titlePlaceholder, { exact: true })
      const description = page.getByPlaceholder(c.jobs.form.descriptionPlaceholder, { exact: true })
      const original = marker + ' Human-written draft only.'
      await title.fill(marker)
      await description.fill(original)
      expect(await db.job.count({ where: { companyId } })).toBe(0)
      await page.getByRole('button', { name: c.jobs.form.saveDraft, exact: true }).click()
      await expect(page).toHaveURL(new RegExp('/' + locale + '/e/jobs/[^/]+/edit$'))
      const job = await db.job.findFirstOrThrow({ where: { companyId, title: marker } })
      expect(job).toMatchObject({ description: original, status: 'DRAFT', createdById: actor.userId })
      const revised = original + ' Revised manually.'
      await page.getByPlaceholder(c.jobs.form.descriptionPlaceholder, { exact: true }).fill(revised)
      expect((await db.job.findUniqueOrThrow({ where: { id: job.id } })).description).toBe(original)
      await page.getByRole('button', { name: c.jobs.form.saveDraft, exact: true }).click()
      await expect.poll(async () => (await db.job.findUniqueOrThrow({ where: { id: job.id } })).description).toBe(revised)
      expect((await db.job.findUniqueOrThrow({ where: { id: job.id } })).status).toBe('DRAFT')
      for (const width of [375, 1280]) {
        await page.setViewportSize({ width, height: 900 })
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2)).toBe(true)
        const file = info.outputPath(locale + '-manual-job-' + width + '.png')
        await page.screenshot({ path: file, fullPage: true })
        await info.attach(locale + '-manual-job-' + width, { path: file, contentType: 'image/png' })
      }
      // A controlled terminal fixture checks the existing readonly guard. It is
      // not used to claim that the ordinary close action ran.
      await db.job.update({ where: { id: job.id }, data: { status: 'CLOSED' } })
      await page.reload()
      await expect(page.getByRole('button', { name: c.assistant, exact: true })).toHaveCount(0)
      await expect(page.getByPlaceholder(c.jobs.form.descriptionPlaceholder, { exact: true })).toBeDisabled()
      await expect(page.getByRole('button', { name: c.jobs.form.saveDraft, exact: true })).toHaveCount(0)
      expect(await db.job.count({ where: { companyId } })).toBe(1)
    } finally {
      await db.job.deleteMany({ where: { companyId, title: marker } })
      await db.company.delete({ where: { id: companyId } })
      await db.user.delete({ where: { id: actor.userId } })
      // AuditLog stays append-only. No global setting was changed.
    }
  })
}

test('a different company cannot obtain the editor or assistant for a private draft', async ({ page }) => {
  expect(test.info().config.workers).toBe(1)
  const actor = await loginAs(page, { role: 'EMPLOYER', company: { memberRole: 'RECRUITER' } })
  const marker = 'M9T02_UI_' + randomUUID().replaceAll('-', '')
  const foreign = await db.company.create({ data: { legalName: marker } })
  const job = await db.job.create({ data: {
    companyId: foreign.id, createdById: actor.userId, title: marker, description: marker + ' private draft',
    type: 'INTERNSHIP', status: 'DRAFT', workMode: 'REMOTE',
  } })
  try {
    const response = await page.goto('/en/e/jobs/' + job.id + '/edit')
    expect(response?.status()).toBe(404)
    await expect(page.getByRole('button', { name: copy.en.assistant, exact: true })).toHaveCount(0)
    expect((await page.content()).includes(job.description)).toBe(false)
    expect(await db.job.findUnique({ where: { id: job.id } })).toEqual(job)
  } finally {
    await db.job.delete({ where: { id: job.id } })
    await db.company.deleteMany({ where: { id: { in: [foreign.id, actor.companyId!] } } })
    await db.user.delete({ where: { id: actor.userId } })
  }
})
