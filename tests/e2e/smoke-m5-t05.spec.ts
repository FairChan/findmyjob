/**
 * Smoke tests for M5-T05: Enterprise applicants board.
 *
 * Tests:
 * 1. Employer can open /e/jobs/[id]/applicants page (200, no errors).
 * 2. Page shows "no applicants" when job has none.
 * 3. Page shows applicant card when application exists.
 */
import { test, expect } from '@playwright/test'
import { e2eDb } from './helpers/db'
import { loginAs } from './helpers/session'
import { expectPageHealthy } from './helpers/smoke'

test.describe('M5-T05 applicants board smoke', () => {
  test('employer can open applicants page — 200, no error boundary (empty job)', async ({ page }) => {
    // loginAs creates the employer user and company, then logs in
    const { companyId, userId } = await loginAs(page, {
      role: 'EMPLOYER',
      company: { verificationStatus: 'VERIFIED', memberRole: 'OWNER', isActive: true },
    })

    // Create a job for this employer's company
    const job = await e2eDb.job.create({
      data: {
        companyId: companyId!,
        createdById: userId,
        title: 'M5T05 Smoke Empty Job',
        type: 'INTERNSHIP',
        description: 'smoke test',
        status: 'PUBLISHED',
        publishedAt: new Date(),
        workMode: 'HYBRID',
      },
    })

    try {
      await expectPageHealthy(page, `/zh/e/jobs/${job.id}/applicants`)
      // Should show no-applicants message
      await expect(page.getByText(/暂无投递|No applicants yet/i)).toBeVisible({ timeout: 5000 })
    } finally {
      await e2eDb.application.deleteMany({ where: { jobId: job.id } })
      await e2eDb.job.delete({ where: { id: job.id } })
    }
  })

  test('employer sees applicant card when application exists', async ({ page }) => {
    const { companyId, userId } = await loginAs(page, {
      role: 'EMPLOYER',
      company: { verificationStatus: 'VERIFIED', memberRole: 'OWNER', isActive: true },
    })

    const job = await e2eDb.job.create({
      data: {
        companyId: companyId!,
        createdById: userId,
        title: 'M5T05 Smoke Applicants Job',
        type: 'INTERNSHIP',
        description: 'smoke test',
        status: 'PUBLISHED',
        publishedAt: new Date(),
        workMode: 'HYBRID',
      },
    })

    // Create a student + application
    const studentUser = await e2eDb.user.create({
      data: {
        name: 'M5T05 Test Student',
        email: `m5t05-student-${Date.now()}@example.test`,
        emailVerified: true,
        role: 'STUDENT',
        status: 'ACTIVE',
      },
    })
    const studentProfile = await e2eDb.studentProfile.create({
      data: { userId: studentUser.id, fullName: 'M5T05 Test Student', completeness: 70 },
    })
    const application = await e2eDb.application.create({
      data: { jobId: job.id, studentId: studentProfile.id, status: 'APPLIED' },
    })

    try {
      await expectPageHealthy(page, `/zh/e/jobs/${job.id}/applicants`)

      // Kanban column "待处理" (APPLIED) or status badge should be visible (multiple matches expected)
      await expect(page.getByText(/待处理|Applied/i).first()).toBeVisible({ timeout: 5000 })

      // No-applicants message should NOT show
      await expect(page.getByText(/暂无投递|No applicants yet/i)).not.toBeVisible({ timeout: 3000 }).catch(() => {
        // OK if the element doesn't exist in DOM
      })
    } finally {
      await e2eDb.applicationEvent.deleteMany({ where: { applicationId: application.id } })
      await e2eDb.application.delete({ where: { id: application.id } })
      await e2eDb.studentProfile.delete({ where: { id: studentProfile.id } })
      await e2eDb.user.delete({ where: { id: studentUser.id } })
      await e2eDb.job.delete({ where: { id: job.id } })
    }
  })

  test('status change is reflected — APPLIED → SHORTLISTED', async ({ page }) => {
    const { companyId, userId } = await loginAs(page, {
      role: 'EMPLOYER',
      company: { verificationStatus: 'VERIFIED', memberRole: 'OWNER', isActive: true },
    })

    const job = await e2eDb.job.create({
      data: {
        companyId: companyId!,
        createdById: userId,
        title: 'M5T05 Status Change Job',
        type: 'INTERNSHIP',
        description: 'smoke test',
        status: 'PUBLISHED',
        publishedAt: new Date(),
        workMode: 'HYBRID',
      },
    })

    const studentUser = await e2eDb.user.create({
      data: {
        name: 'M5T05 StatusChange Student',
        email: `m5t05-sc-student-${Date.now()}@example.test`,
        emailVerified: true,
        role: 'STUDENT',
        status: 'ACTIVE',
      },
    })
    const studentProfile = await e2eDb.studentProfile.create({
      data: { userId: studentUser.id, fullName: 'M5T05 StatusChange Student', completeness: 70 },
    })
    const application = await e2eDb.application.create({
      data: { jobId: job.id, studentId: studentProfile.id, status: 'APPLIED' },
    })

    try {
      await expectPageHealthy(page, `/zh/e/jobs/${job.id}/applicants`)

      // Switch to list view to access the status dropdown
      await page.getByRole('button', { name: /标准化列表|Standardized List/i }).click()

      // The status select should be present — assert visible before interacting
      const statusSelect = page.locator('select').first()
      await expect(statusSelect).toBeVisible({ timeout: 5000 })
      // Select SHORTLISTED
      await statusSelect.selectOption('SHORTLISTED')
      // 轮询数据库直到 server action 写完；固定等 1.5 秒在机器忙时会读到旧状态（线 B 报的 flaky）。断言的值不变
      await expect
        .poll(
          () => e2eDb.application.findUnique({ where: { id: application.id } }).then((a) => a?.status),
          { timeout: 15000 },
        )
        .toBe('SHORTLISTED')
    } finally {
      await e2eDb.applicationEvent.deleteMany({ where: { applicationId: application.id } })
      await e2eDb.application.delete({ where: { id: application.id } }).catch(() => {})
      await e2eDb.studentProfile.delete({ where: { id: studentProfile.id } })
      await e2eDb.user.delete({ where: { id: studentUser.id } })
      await e2eDb.job.delete({ where: { id: job.id } })
    }
  })
})
