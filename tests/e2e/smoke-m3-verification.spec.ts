/**
 * Smoke tests for M3-T02 employer/verification page.
 * Verifies the page renders without crashes in the three editable states.
 */
import { test, expect } from '@playwright/test'
import { loginAs } from './helpers/session'
import { expectPageHealthy } from './helpers/smoke'
import { PrismaClient } from '@prisma/client'

const db = new PrismaClient()

test.describe('M3 verification page smoke', () => {
  test('OWNER of UNSUBMITTED company: /zh/e/verification is healthy', async ({ page }) => {
    await loginAs(page, {
      role: 'EMPLOYER',
      company: { verificationStatus: 'UNSUBMITTED', memberRole: 'OWNER', isActive: true },
    })
    await expectPageHealthy(page, '/zh/e/verification')
  })

  test('OWNER of REJECTED company: /zh/e/verification is healthy and shows rejection reason', async ({
    page,
  }) => {
    const result = await loginAs(page, {
      role: 'EMPLOYER',
      company: { verificationStatus: 'REJECTED', memberRole: 'OWNER', isActive: true },
    })

    // Insert a rejected CompanyVerification record with a reviewNote
    if (result.companyId) {
      await db.companyVerification.create({
        data: {
          companyId: result.companyId,
          documentKeys: [`verifications/${result.companyId}/smoke-test.pdf`],
          status: 'REJECTED',
          submittedById: result.userId,
          reviewNote: 'SSM document was expired',
          reviewedAt: new Date(),
        },
      })
    }

    await expectPageHealthy(page, '/zh/e/verification')

    // Rejection reason must be visible
    await expect(page.getByText('SSM document was expired')).toBeVisible()
  })

  test('OWNER of PENDING company: /zh/e/verification is healthy', async ({ page }) => {
    await loginAs(page, {
      role: 'EMPLOYER',
      company: { verificationStatus: 'PENDING', memberRole: 'OWNER', isActive: true },
    })
    await expectPageHealthy(page, '/zh/e/verification')
  })
})
