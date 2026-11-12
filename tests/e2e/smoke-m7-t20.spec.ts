import { test, expect } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { e2eDb } from './helpers/db'
import { loginAs } from './helpers/session'
import { expectPageHealthy } from './helpers/smoke'
import { createEmployer, createJob, createStudent } from '../factories'

test('M7-T20: accepts two historical invitations without duplicating application or unlock', async ({ page }) => {
  const student = await loginAs(page, { role: 'STUDENT' })
  const profile = await e2eDb.studentProfile.create({ data: {
    userId: student.userId, fullName: 'Synthetic Invitation Student', completeness: 80,
    visibility: 'PUBLIC', schoolVerifiedAt: new Date(),
  } })
  const employer = await createEmployer(e2eDb, { email: `m7-t20-employer-${randomUUID()}@example.test` })
  await e2eDb.company.update({ where: { id: employer.companyId }, data: { verificationStatus: 'VERIFIED' } })
  const job = await createJob(e2eDb, employer.companyId, employer.userId)
  const data = {
    companyId: employer.companyId, jobId: job.id, studentId: profile.id,
    sentById: employer.userId, expiresAt: new Date(Date.now() + 86_400_000),
  }
  const a = await e2eDb.invitation.create({ data })
  const b = await e2eDb.invitation.create({ data })
  try {
    await expectPageHealthy(page, '/zh/s/invitations')
    await page.getByRole('button', { name: '接受并投递', exact: true }).first().click()
    await expect(page.getByText('已接受', { exact: true })).toHaveCount(1)
    await page.getByRole('button', { name: '接受并投递', exact: true }).click()
    await expect(page.getByText('已接受', { exact: true })).toHaveCount(2)
    const invitations = await e2eDb.invitation.findMany({ where: { id: { in: [a.id, b.id] } } })
    expect(invitations.filter((inv) => inv.applicationId !== null)).toHaveLength(1)
    expect(await e2eDb.application.count({ where: { jobId: job.id, studentId: profile.id } })).toBe(1)
    expect(await e2eDb.talentUnlock.count({ where: { companyId: employer.companyId, studentId: profile.id } })).toBe(1)
  } finally {
    await e2eDb.invitation.deleteMany({ where: { jobId: job.id } })
    await e2eDb.applicationEvent.deleteMany({ where: { application: { jobId: job.id } } })
    await e2eDb.application.deleteMany({ where: { jobId: job.id } })
    await e2eDb.job.delete({ where: { id: job.id } })
    await e2eDb.company.delete({ where: { id: employer.companyId } })
    await e2eDb.user.deleteMany({ where: { id: { in: [student.userId, employer.userId] } } })
  }
})

test('M7-T20: already-applied invitation error is translated in both languages', async ({ page }) => {
  const employer = await loginAs(page, { role: 'EMPLOYER', company: { verificationStatus: 'VERIFIED' } })
  const student = await createStudent(e2eDb, { email: `m7-t20-student-${randomUUID()}@example.test`, completeness: 80 })
  await e2eDb.studentProfile.update({ where: { id: student.profileId }, data: {
    visibility: 'PUBLIC', schoolVerifiedAt: new Date(),
  } })
  const job = await createJob(e2eDb, employer.companyId!, employer.userId)
  await e2eDb.application.create({ data: { jobId: job.id, studentId: student.profileId } })
  try {
    for (const copy of [
      { locale: 'zh', invite: '邀请投递', send: '发送邀请', error: '该候选人已投递此职位' },
      { locale: 'en', invite: 'Invite to Apply', send: 'Send Invitation', error: 'This candidate has already applied for this position' },
    ]) {
      await expectPageHealthy(page, `/${copy.locale}/e/talent/${student.profileId}`)
      await page.getByRole('button', { name: copy.invite, exact: true }).click()
      await page.getByRole('dialog').getByRole('button', { name: copy.send, exact: true }).click()
      await expect(page.getByRole('dialog').getByText(copy.error, { exact: true })).toBeVisible()
    }
    expect(await e2eDb.invitation.count({ where: { jobId: job.id } })).toBe(0)
  } finally {
    await e2eDb.application.deleteMany({ where: { jobId: job.id } })
    await e2eDb.job.delete({ where: { id: job.id } })
    await e2eDb.company.delete({ where: { id: employer.companyId! } })
    await e2eDb.user.deleteMany({ where: { id: { in: [student.userId, employer.userId] } } })
  }
})

test('M7-T20: all four weekly charts render in both languages at mobile and desktop widths', async ({ page }) => {
  const admin = await loginAs(page, { role: 'ADMIN' })
  try {
    for (const copy of [
      { locale: 'zh', titles: ['每周新注册学生', '每周新增投递', '每周新增解锁', '每周新发布职位'] },
      { locale: 'en', titles: ['Weekly New Students', 'Weekly Applications', 'Weekly Unlocks', 'Weekly Published Jobs'] },
    ]) {
      for (const width of [375, 1280]) {
        await page.setViewportSize({ width, height: 900 })
        await expectPageHealthy(page, `/${copy.locale}/admin`)
        for (const title of copy.titles) {
          const heading = page.getByText(title, { exact: true })
          await expect(heading).toBeVisible()
          const chart = heading.locator('..')
          const bounds = await chart.boundingBox()
          expect(bounds).not.toBeNull()
          expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width)
          const lastLabel = await chart.locator('span').last().boundingBox()
          expect(lastLabel).not.toBeNull()
          expect(lastLabel!.x + lastLabel!.width).toBeLessThanOrEqual(width)
        }
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
        await page.screenshot({ path: test.info().outputPath(`dashboard-${copy.locale}-${width}.png`), fullPage: true })
      }
    }
  } finally {
    await e2eDb.user.delete({ where: { id: admin.userId } })
  }
})
