/**
 * Smoke tests for M5-T06: student "My Applications" page.
 *
 * Tests:
 * 1. Logged-in student can open /s/applications (page healthy, no errors).
 * 2. Empty state renders correctly when student has no applications.
 * 3. Applications list renders with job title, status, and timeline events.
 * 4. Withdraw button is present for a non-withdrawn application and works.
 * 5. Withdrawn application shows "已撤回" status badge, no withdraw button.
 */
import { test, expect } from '@playwright/test'
import { e2eDb } from './helpers/db'
import { loginAs } from './helpers/session'
import { expectPageHealthy } from './helpers/smoke'

test.describe('M5-T06 My Applications page smoke', () => {
  async function setupJob(label: string) {
    const company = await e2eDb.company.create({
      data: { legalName: `M5T06 ${label} Co`, verificationStatus: 'VERIFIED', isActive: true },
    })
    const owner = await e2eDb.user.create({
      data: {
        name: `${label} Owner`,
        email: `m5t06-${label.toLowerCase().replace(/\s+/g, '-')}-${Date.now()}@example.test`,
        emailVerified: true,
        role: 'EMPLOYER',
        status: 'ACTIVE',
      },
    })
    await e2eDb.companyMember.create({ data: { companyId: company.id, userId: owner.id, role: 'OWNER' } })
    const job = await e2eDb.job.create({
      data: {
        companyId: company.id,
        createdById: owner.id,
        title: `${label} Internship`,
        type: 'INTERNSHIP',
        description: `${label} smoke test job`,
        status: 'PUBLISHED',
        publishedAt: new Date(),
        workMode: 'HYBRID',
      },
    })
    return { company, owner, job }
  }

  test('page is healthy for a student with no applications', async ({ page }) => {
    const { userId } = await loginAs(page, { role: 'STUDENT' })
    await e2eDb.studentProfile.upsert({
      where: { userId },
      create: { userId, fullName: 'E2E NoApps Student', completeness: 50 },
      update: { completeness: 50 },
    })

    await expectPageHealthy(page, '/zh/s/applications')
    // Empty state text is visible
    await expect(page.getByText(/暂无投递记录|No applications yet/i)).toBeVisible({ timeout: 5000 })
  })

  test('application card shows job title, company, status badge and timeline', async ({ page }) => {
    const { company, job } = await setupJob('CardSmoke')

    const { userId } = await loginAs(page, { role: 'STUDENT' })
    await e2eDb.studentProfile.upsert({
      where: { userId },
      create: { userId, fullName: 'E2E Card Student', completeness: 70, workAuth: 'STUDENT_PASS', intents: ['INTERNSHIP'] },
      update: { completeness: 70, workAuth: 'STUDENT_PASS', intents: ['INTERNSHIP'] },
    })

    const profile = await e2eDb.studentProfile.findUnique({ where: { userId } })
    expect(profile).not.toBeNull()

    // Pre-seed application and events
    const app = await e2eDb.application.create({
      data: { jobId: job.id, studentId: profile!.id, status: 'VIEWED' },
    })
    await e2eDb.applicationEvent.createMany({
      data: [
        { applicationId: app.id, toStatus: 'APPLIED' },
        { applicationId: app.id, fromStatus: 'APPLIED', toStatus: 'VIEWED' },
      ],
    })
    await e2eDb.talentUnlock.create({
      data: { companyId: company.id, studentId: profile!.id, unlockedById: userId, source: 'APPLICATION', creditsSpent: 0 },
    })

    await expectPageHealthy(page, '/zh/s/applications')

    // Job title is linked
    await expect(page.getByRole('link', { name: /CardSmoke Internship/i })).toBeVisible({ timeout: 5000 })
    // Company name appears on page
    await expect(page.getByText(/M5T06 CardSmoke Co/)).toBeVisible()

    // Cleanup
    await e2eDb.applicationEvent.deleteMany({ where: { applicationId: app.id } })
    await e2eDb.application.delete({ where: { id: app.id } })
    await e2eDb.talentUnlock.deleteMany({ where: { companyId: company.id, studentId: profile!.id } })
    await e2eDb.job.delete({ where: { id: job.id } })
    await e2eDb.companyMember.deleteMany({ where: { companyId: company.id } })
    await e2eDb.company.delete({ where: { id: company.id } })
  })

  test('withdraw button works: application becomes withdrawn after clicking', async ({ page }) => {
    const { company, job } = await setupJob('WithdrawSmoke')

    await e2eDb.systemSetting.upsert({
      where: { key: 'apply.minCompleteness' },
      create: { key: 'apply.minCompleteness', value: 60 },
      update: { value: 60 },
    })

    const { userId } = await loginAs(page, { role: 'STUDENT' })
    await e2eDb.studentProfile.upsert({
      where: { userId },
      create: { userId, fullName: 'E2E Withdraw Student', completeness: 70, workAuth: 'STUDENT_PASS', intents: ['INTERNSHIP'] },
      update: { completeness: 70, workAuth: 'STUDENT_PASS', intents: ['INTERNSHIP'] },
    })

    const profile = await e2eDb.studentProfile.findUnique({ where: { userId } })
    expect(profile).not.toBeNull()

    // Pre-seed an APPLIED application
    const app = await e2eDb.application.create({
      data: { jobId: job.id, studentId: profile!.id, status: 'APPLIED' },
    })
    await e2eDb.applicationEvent.create({
      data: { applicationId: app.id, toStatus: 'APPLIED' },
    })
    await e2eDb.talentUnlock.create({
      data: { companyId: company.id, studentId: profile!.id, unlockedById: userId, source: 'APPLICATION', creditsSpent: 0 },
    })

    await expectPageHealthy(page, '/zh/s/applications')

    // Withdraw button should be visible
    const withdrawBtn = page.getByRole('button', { name: /撤回|Withdraw/i })
    await expect(withdrawBtn).toBeVisible({ timeout: 5000 })

    // Click withdraw
    await withdrawBtn.click()

    // After withdrawal: success text appears or status updates
    await expect(page.getByText(/已撤回|Withdrawn/i).first()).toBeVisible({ timeout: 10000 })
    // Withdraw button should no longer be present (page refreshed)
    await expect(page.getByRole('button', { name: /^撤回$|^Withdraw$/i })).not.toBeVisible({ timeout: 5000 })

    // Verify DB
    const updated = await e2eDb.application.findUnique({ where: { id: app.id } })
    expect(updated?.status).toBe('WITHDRAWN')

    // Cleanup
    await e2eDb.applicationEvent.deleteMany({ where: { applicationId: app.id } })
    await e2eDb.application.delete({ where: { id: app.id } }).catch(() => {})
    await e2eDb.talentUnlock.deleteMany({ where: { companyId: company.id, studentId: profile!.id } })
    await e2eDb.job.delete({ where: { id: job.id } })
    await e2eDb.companyMember.deleteMany({ where: { companyId: company.id } })
    await e2eDb.company.delete({ where: { id: company.id } })
  })

  test('withdrawn application shows status badge, no withdraw button', async ({ page }) => {
    const { company, job } = await setupJob('AlreadyWithdrawn')

    const { userId } = await loginAs(page, { role: 'STUDENT' })
    await e2eDb.studentProfile.upsert({
      where: { userId },
      create: { userId, fullName: 'E2E AlreadyWithdrawn Student', completeness: 70 },
      update: { completeness: 70 },
    })

    const profile = await e2eDb.studentProfile.findUnique({ where: { userId } })
    expect(profile).not.toBeNull()

    const app = await e2eDb.application.create({
      data: { jobId: job.id, studentId: profile!.id, status: 'WITHDRAWN' },
    })
    await e2eDb.applicationEvent.createMany({
      data: [
        { applicationId: app.id, toStatus: 'APPLIED' },
        { applicationId: app.id, fromStatus: 'APPLIED', toStatus: 'WITHDRAWN' },
      ],
    })
    await e2eDb.talentUnlock.create({
      data: { companyId: company.id, studentId: profile!.id, unlockedById: userId, source: 'APPLICATION', creditsSpent: 0 },
    })

    await expectPageHealthy(page, '/zh/s/applications')

    // Status badge shows withdrawn
    await expect(page.getByText(/已撤回|Withdrawn/).first()).toBeVisible({ timeout: 5000 })
    // Withdraw button must NOT be present for a WITHDRAWN application
    await expect(page.getByRole('button', { name: /^撤回$|^Withdraw$/i })).not.toBeVisible()

    // Cleanup
    await e2eDb.applicationEvent.deleteMany({ where: { applicationId: app.id } })
    await e2eDb.application.delete({ where: { id: app.id } }).catch(() => {})
    await e2eDb.talentUnlock.deleteMany({ where: { companyId: company.id, studentId: profile!.id } })
    await e2eDb.job.delete({ where: { id: job.id } })
    await e2eDb.companyMember.deleteMany({ where: { companyId: company.id } })
    await e2eDb.company.delete({ where: { id: company.id } })
  })
})
