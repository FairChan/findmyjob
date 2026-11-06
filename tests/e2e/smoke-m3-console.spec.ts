/**
 * Smoke tests for M3-T05 (company public page) and M3-T06 (employer console).
 * Added by fix(M3-T06) 2026-11-07 per total-control requirement.
 *
 * Session strategy: the 4 OWNER-state tests share ONE storageState (1 login) to stay
 * within the Better Auth in-memory rate limit of 5 sign-ins/min. The RECRUITER and
 * deactivated tests each need a fresh user, so they perform their own login (2 more).
 * Total: 3 logins per run.
 */
import { test, expect } from '@playwright/test'
import { loginAs } from './helpers/session'
import { expectPageHealthy } from './helpers/smoke'
import { PrismaClient } from '@prisma/client'
import os from 'os'
import path from 'path'
import fs from 'fs'

const db = new PrismaClient()

// Run all tests in this file serially so the shared owner company state is modified safely.
test.describe.configure({ mode: 'serial' })

// ---------------------------------------------------------------------------
// M3-T06: Employer console /zh/e
// ---------------------------------------------------------------------------

test.describe('M3-T06 employer console smoke', () => {
  let ownerStorageState: string
  let ownerCompanyId: string

  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext()
    const p = await ctx.newPage()
    const r = await loginAs(p, {
      role: 'EMPLOYER',
      company: { verificationStatus: 'UNSUBMITTED', memberRole: 'OWNER', isActive: true },
    })
    ownerCompanyId = r.companyId!
    ownerStorageState = path.join(os.tmpdir(), `e2e-owner-${Date.now()}.json`)
    await ctx.storageState({ path: ownerStorageState })
    await ctx.close()
  })

  test.afterAll(() => {
    try { fs.unlinkSync(ownerStorageState) } catch {}
  })

  test('OWNER UNSUBMITTED: /zh/e is healthy', async ({ browser }) => {
    // Company starts in UNSUBMITTED state (set in beforeAll)
    const ctx = await browser.newContext({ storageState: ownerStorageState })
    const p = await ctx.newPage()
    await expectPageHealthy(p, '/zh/e')
    await ctx.close()
  })

  test('OWNER PENDING: /zh/e is healthy', async ({ browser }) => {
    await db.company.update({
      where: { id: ownerCompanyId },
      data: { verificationStatus: 'PENDING' },
    })
    const ctx = await browser.newContext({ storageState: ownerStorageState })
    const p = await ctx.newPage()
    await expectPageHealthy(p, '/zh/e')
    await ctx.close()
  })

  test('OWNER REJECTED: /zh/e is healthy', async ({ browser }) => {
    await db.company.update({
      where: { id: ownerCompanyId },
      data: { verificationStatus: 'REJECTED' },
    })
    // Insert a rejection record so the note is visible
    const userId = await db.companyMember
      .findFirst({ where: { companyId: ownerCompanyId }, select: { userId: true } })
      .then(m => m!.userId)
    await db.companyVerification.create({
      data: {
        companyId: ownerCompanyId,
        documentKeys: [`verifications/${ownerCompanyId}/owner-smoke.pdf`],
        status: 'REJECTED',
        submittedById: userId,
        reviewNote: 'Owner smoke rejection note',
        reviewedAt: new Date(),
      },
    })
    const ctx = await browser.newContext({ storageState: ownerStorageState })
    const p = await ctx.newPage()
    await expectPageHealthy(p, '/zh/e')
    await ctx.close()
  })

  test('OWNER VERIFIED: /zh/e is healthy', async ({ browser }) => {
    await db.company.update({
      where: { id: ownerCompanyId },
      data: { verificationStatus: 'VERIFIED' },
    })
    const ctx = await browser.newContext({ storageState: ownerStorageState })
    const p = await ctx.newPage()
    await expectPageHealthy(p, '/zh/e')
    await ctx.close()
  })

  test('RECRUITER REJECTED: page healthy, rejection reason visible, no /e/verification link', async ({
    page,
  }) => {
    const result = await loginAs(page, {
      role: 'EMPLOYER',
      company: { verificationStatus: 'REJECTED', memberRole: 'RECRUITER', isActive: true },
    })
    if (result.companyId) {
      await db.companyVerification.create({
        data: {
          companyId: result.companyId,
          documentKeys: [`verifications/${result.companyId}/recruiter-smoke.pdf`],
          status: 'REJECTED',
          submittedById: result.userId,
          reviewNote: 'Recruiter visible rejection note',
          reviewedAt: new Date(),
        },
      })
    }
    await expectPageHealthy(page, '/zh/e')
    await expect(page.getByText('Recruiter visible rejection note')).toBeVisible()
    // /e/verification CTA link must NOT appear for RECRUITER
    await expect(page.getByRole('link', { name: /认证材料|Verification/ })).not.toBeVisible()
  })

  test('deactivated company member: /zh/e is denied (not 200)', async ({ page }) => {
    await loginAs(page, {
      role: 'EMPLOYER',
      company: { verificationStatus: 'UNSUBMITTED', memberRole: 'OWNER', isActive: false },
    })
    const res = await page.goto('/zh/e')
    // Must NOT return 200; inactive company triggers ForbiddenError
    expect(res?.status()).not.toBe(200)
  })
})

// ---------------------------------------------------------------------------
// M3-T05: Company public page /zh/companies/[id]
// ---------------------------------------------------------------------------

test.describe('M3-T05 company public page smoke', () => {
  test('unauthenticated: VERIFIED company public page is healthy', async ({ page }) => {
    const company = await db.company.create({
      data: {
        legalName: 'Smoke Test Corp Sdn Bhd',
        verificationStatus: 'VERIFIED',
        isActive: true,
      },
    })
    await expectPageHealthy(page, `/zh/companies/${company.id}`)
  })

  test('unverified company public page returns 404', async ({ page }) => {
    const company = await db.company.create({
      data: {
        legalName: 'Unverified Smoke Corp',
        verificationStatus: 'UNSUBMITTED',
        isActive: true,
      },
    })
    const res = await page.goto(`/zh/companies/${company.id}`)
    expect(res?.status()).toBe(404)
  })
})
