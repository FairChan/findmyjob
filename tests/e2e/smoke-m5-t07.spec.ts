/**
 * Smoke tests for M5-T07: invitations.
 *
 * Tests:
 * 1. Student /s/invitations page loads without errors.
 * 2. Employer /e/invitations page loads without errors.
 * 3. Full flow: pre-seed invitation in DB, student visits page and accepts.
 */
import { test, expect } from '@playwright/test'
import { e2eDb } from './helpers/db'
import { loginAs } from './helpers/session'
import { expectPageHealthy } from './helpers/smoke'

test.describe('M5-T07 invitations smoke', () => {
  test('student /s/invitations page is healthy', async ({ page }) => {
    await loginAs(page, { role: 'STUDENT' })
    await expectPageHealthy(page, '/zh/s/invitations')
  })

  test('employer /e/invitations page is healthy', async ({ page }) => {
    const emp = await loginAs(page, { role: 'EMPLOYER' })
    const member = await e2eDb.companyMember.findFirst({ where: { userId: emp.userId } })
    if (member) {
      await e2eDb.company.update({
        where: { id: member.companyId },
        data: { verificationStatus: 'VERIFIED' },
      })
    }
    await expectPageHealthy(page, '/zh/e/invitations')
  })

  test('student accepts pre-seeded invitation → application created', async ({ page }) => {
    // Create employer + company + job
    const empUser = await e2eDb.user.create({
      data: {
        name: 'M5T07 Employer',
        email: `m5t07-emp-${Date.now()}@example.test`,
        emailVerified: true,
        role: 'EMPLOYER',
        status: 'ACTIVE',
      },
    })
    const company = await e2eDb.company.create({
      data: { legalName: 'M5T07 Smoke Co', verificationStatus: 'VERIFIED', isActive: true },
    })
    await e2eDb.companyMember.create({
      data: { userId: empUser.id, companyId: company.id, role: 'OWNER' },
    })
    const job = await e2eDb.job.create({
      data: {
        companyId: company.id,
        createdById: empUser.id,
        title: 'M5T07 Smoke Job',
        description: 'Smoke test',
        type: 'INTERNSHIP',
        workMode: 'HYBRID',
        status: 'PUBLISHED',
        publishedAt: new Date(),
      },
    })

    // Log in as a student
    const { userId: studUserId } = await loginAs(page, { role: 'STUDENT' })

    // Ensure the student has a profile
    const profile = await e2eDb.studentProfile.upsert({
      where: { userId: studUserId },
      create: {
        userId: studUserId,
        fullName: 'M5T07 Smoke Student',
        completeness: 80,
        visibility: 'PUBLIC',
        schoolVerifiedAt: new Date(),
      },
      update: {
        completeness: 80,
        visibility: 'PUBLIC',
        schoolVerifiedAt: new Date(),
      },
    })

    // Pre-seed invitation
    const inv = await e2eDb.invitation.create({
      data: {
        companyId: company.id,
        jobId: job.id,
        studentId: profile.id,
        sentById: empUser.id,
        status: 'SENT',
        expiresAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
      },
    })

    try {
      await expectPageHealthy(page, '/zh/s/invitations')

      // Accept button should be visible for SENT invitation
      const acceptBtn = page.getByRole('button', { name: /接受|Accept/i }).first()
      await expect(acceptBtn).toBeVisible({ timeout: 5000 })
      await acceptBtn.click()

      // Should show accepted state
      await expect(page.getByText(/已接受|Accepted/i)).toBeVisible({ timeout: 10000 })

      // Verify application created in DB
      const app = await e2eDb.application.findFirst({
        where: { studentId: profile.id, jobId: job.id },
      })
      expect(app).not.toBeNull()
      expect(app?.status).toBe('APPLIED')

      // Verify invitation linked
      const updatedInv = await e2eDb.invitation.findUnique({ where: { id: inv.id } })
      expect(updatedInv?.status).toBe('ACCEPTED')
      expect(updatedInv?.applicationId).toBe(app?.id)
    } finally {
      await e2eDb.applicationEvent.deleteMany({ where: { application: { jobId: job.id } } })
      await e2eDb.application.deleteMany({ where: { jobId: job.id } }).catch(() => {})
      await e2eDb.invitation.deleteMany({ where: { jobId: job.id } }).catch(() => {})
      await e2eDb.job.delete({ where: { id: job.id } }).catch(() => {})
      await e2eDb.companyMember.deleteMany({ where: { companyId: company.id } }).catch(() => {})
      await e2eDb.company.delete({ where: { id: company.id } }).catch(() => {})
      await e2eDb.user.delete({ where: { id: empUser.id } }).catch(() => {})
    }
  })
})
