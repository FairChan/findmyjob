/**
 * Smoke tests for M5-T14: standardized list table, 10-row visibility, detail navigation.
 *
 * Tests:
 * 1. At 1280×800, switching to list view shows 10 rows in the table simultaneously.
 * 2. Clicking "View Profile" on a table row navigates to /e/talent/[id].
 * 3. Employer can open applicants page (smoke — no errors).
 */
import { test, expect } from '@playwright/test'
import { e2eDb } from './helpers/db'
import { loginAs } from './helpers/session'
import { expectPageHealthy } from './helpers/smoke'

async function createStudentWithProfile(suffix: string) {
  const user = await e2eDb.user.create({
    data: {
      name: `M5T14 Student ${suffix}`,
      email: `m5t14-stu-${suffix}-${Date.now()}@example.test`,
      emailVerified: true,
      role: 'STUDENT',
      status: 'ACTIVE',
    },
  })
  const profile = await e2eDb.studentProfile.create({
    data: { userId: user.id, fullName: `M5T14 Student ${suffix}`, completeness: 70 },
  })
  return { user, profile }
}

test.describe('M5-T14 standardized list smoke', () => {
  test('standardized list shows 10 rows at 1280×800', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 })

    const { companyId, userId } = await loginAs(page, {
      role: 'EMPLOYER',
      company: { verificationStatus: 'VERIFIED', memberRole: 'OWNER', isActive: true },
    })

    const job = await e2eDb.job.create({
      data: {
        companyId: companyId!,
        createdById: userId,
        title: 'M5T14 10-Row List Job',
        type: 'INTERNSHIP',
        description: 'smoke test',
        status: 'PUBLISHED',
        publishedAt: new Date(),
        workMode: 'HYBRID',
      },
    })

    // Create 10 students + applications
    const created: Array<{ userId: string; profileId: string; appId: string }> = []
    for (let i = 0; i < 10; i++) {
      const { user, profile } = await createStudentWithProfile(`${i}`)
      const app = await e2eDb.application.create({
        data: { jobId: job.id, studentId: profile.id, status: 'APPLIED' },
      })
      created.push({ userId: user.id, profileId: profile.id, appId: app.id })
    }

    try {
      await expectPageHealthy(page, `/zh/e/jobs/${job.id}/applicants`)

      // Switch to list view
      await page.getByRole('button', { name: /标准化列表|Standardized List/i }).click()

      // The table should now be visible
      await expect(page.locator('table[aria-label="standardized-applicant-list"]')).toBeVisible({ timeout: 5000 })

      // Count rows — should be exactly 10 (page 1)
      const rows = page.locator('table[aria-label="standardized-applicant-list"] tbody tr')
      await expect(rows).toHaveCount(10, { timeout: 5000 })

      // All 10 rows must be visible in the viewport
      for (let i = 0; i < 10; i++) {
        await expect(rows.nth(i)).toBeVisible()
      }
    } finally {
      for (const c of created) {
        await e2eDb.applicationEvent.deleteMany({ where: { applicationId: c.appId } })
        await e2eDb.application.delete({ where: { id: c.appId } }).catch(() => {})
        await e2eDb.studentProfile.delete({ where: { id: c.profileId } }).catch(() => {})
        await e2eDb.user.delete({ where: { id: c.userId } }).catch(() => {})
      }
      await e2eDb.job.delete({ where: { id: job.id } }).catch(() => {})
    }
  })

  test('clicking View Profile navigates to talent detail page', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 })

    const { companyId, userId } = await loginAs(page, {
      role: 'EMPLOYER',
      company: { verificationStatus: 'VERIFIED', memberRole: 'OWNER', isActive: true },
    })

    const job = await e2eDb.job.create({
      data: {
        companyId: companyId!,
        createdById: userId,
        title: 'M5T14 View Profile Job',
        type: 'INTERNSHIP',
        description: 'smoke test',
        status: 'PUBLISHED',
        publishedAt: new Date(),
        workMode: 'HYBRID',
      },
    })

    const { user: stuUser, profile: stuProfile } = await createStudentWithProfile('vp')
    const app = await e2eDb.application.create({
      data: { jobId: job.id, studentId: stuProfile.id, status: 'APPLIED' },
    })
    // TalentUnlock so the detail page doesn't block
    await e2eDb.creditWallet.upsert({
      where: { companyId: companyId! },
      create: { companyId: companyId!, balance: 10 },
      update: {},
    })
    await e2eDb.talentUnlock.create({
      data: { companyId: companyId!, studentId: stuProfile.id, unlockedById: userId, source: 'APPLICATION', creditsSpent: 0 },
    })

    try {
      await expectPageHealthy(page, `/zh/e/jobs/${job.id}/applicants`)

      // Switch to list view
      await page.getByRole('button', { name: /标准化列表|Standardized List/i }).click()
      await expect(page.locator('table[aria-label="standardized-applicant-list"]')).toBeVisible({ timeout: 5000 })

      // Click "View Profile" button for the applicant
      const viewBtn = page.getByRole('button', { name: /查看完整档案|View Profile/i }).first()
      await expect(viewBtn).toBeVisible({ timeout: 5000 })
      await viewBtn.click()

      // Should navigate to /e/talent/[id]
      await page.waitForURL(/\/e\/talent\//, { timeout: 10000 })
      expect(page.url()).toMatch(/\/e\/talent\//)
    } finally {
      await e2eDb.talentUnlock.deleteMany({ where: { companyId: companyId!, studentId: stuProfile.id } })
      await e2eDb.applicationEvent.deleteMany({ where: { applicationId: app.id } })
      await e2eDb.application.delete({ where: { id: app.id } }).catch(() => {})
      await e2eDb.studentProfile.delete({ where: { id: stuProfile.id } }).catch(() => {})
      await e2eDb.user.delete({ where: { id: stuUser.id } }).catch(() => {})
      await e2eDb.job.delete({ where: { id: job.id } }).catch(() => {})
    }
  })
})
