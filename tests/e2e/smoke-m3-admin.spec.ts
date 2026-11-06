/**
 * Smoke tests for M3-T03 admin review queue pages.
 * Verifies admin pages render correctly and non-admin access is blocked.
 */
import { test, expect } from '@playwright/test'
import { loginAs } from './helpers/session'
import { expectPageHealthy } from './helpers/smoke'
import { PrismaClient } from '@prisma/client'
import { faker } from '@faker-js/faker'

const db = new PrismaClient()

test.describe('M3-T03 admin review queue smoke', () => {
  test('ADMIN: /zh/admin/companies is healthy', async ({ page }) => {
    await loginAs(page, { role: 'ADMIN' })
    await expectPageHealthy(page, '/zh/admin/companies')
  })

  test('ADMIN: /zh/admin/companies/<id> with PENDING company is healthy', async ({ page }) => {
    await loginAs(page, { role: 'ADMIN' })

    // Create a PENDING company with owner and verification record
    const ownerEmail = `e2e-owner-${Date.now()}@example.test`
    const owner = await db.user.create({
      data: {
        name: faker.person.fullName(),
        email: ownerEmail,
        emailVerified: true,
        role: 'EMPLOYER',
        status: 'ACTIVE',
      },
    })
    const company = await db.company.create({
      data: {
        legalName: faker.company.name(),
        verificationStatus: 'PENDING',
        isActive: true,
      },
    })
    await db.companyMember.create({
      data: { companyId: company.id, userId: owner.id, role: 'OWNER' },
    })
    await db.companyVerification.create({
      data: {
        companyId: company.id,
        documentKeys: [`verifications/${company.id}/ssm.pdf`],
        status: 'PENDING',
        submittedById: owner.id,
      },
    })

    await expectPageHealthy(page, `/zh/admin/companies/${company.id}`)
  })

  test('STUDENT: /zh/admin/companies/<id> is redirected away and owner email not visible', async ({
    page,
  }) => {
    // Create a company and owner whose email should stay hidden
    const ownerEmail = `e2e-hidden-${Date.now()}@example.test`
    const owner = await db.user.create({
      data: {
        name: faker.person.fullName(),
        email: ownerEmail,
        emailVerified: true,
        role: 'EMPLOYER',
        status: 'ACTIVE',
      },
    })
    const company = await db.company.create({
      data: {
        legalName: faker.company.name(),
        verificationStatus: 'PENDING',
        isActive: true,
      },
    })
    await db.companyMember.create({
      data: { companyId: company.id, userId: owner.id, role: 'OWNER' },
    })
    await db.companyVerification.create({
      data: {
        companyId: company.id,
        documentKeys: [`verifications/${company.id}/ssm.pdf`],
        status: 'PENDING',
        submittedById: owner.id,
      },
    })

    await loginAs(page, { role: 'STUDENT' })
    await page.goto(`/zh/admin/companies/${company.id}`)
    await page.waitForLoadState('networkidle').catch(() => {})

    // Should be redirected away from the admin page
    expect(page.url()).not.toContain(`/admin/companies/${company.id}`)

    // Owner email must not appear on the page
    await expect(page.getByText(ownerEmail)).not.toBeVisible()
  })

  test('EMPLOYER: /zh/admin/companies/<id> is redirected away and owner email not visible', async ({
    page,
  }) => {
    // Create a company and owner whose email should stay hidden
    const ownerEmail = `e2e-emp-hidden-${Date.now()}@example.test`
    const owner = await db.user.create({
      data: {
        name: faker.person.fullName(),
        email: ownerEmail,
        emailVerified: true,
        role: 'EMPLOYER',
        status: 'ACTIVE',
      },
    })
    const company = await db.company.create({
      data: {
        legalName: faker.company.name(),
        verificationStatus: 'PENDING',
        isActive: true,
      },
    })
    await db.companyMember.create({
      data: { companyId: company.id, userId: owner.id, role: 'OWNER' },
    })
    await db.companyVerification.create({
      data: {
        companyId: company.id,
        documentKeys: [`verifications/${company.id}/ssm.pdf`],
        status: 'PENDING',
        submittedById: owner.id,
      },
    })

    await loginAs(page, {
      role: 'EMPLOYER',
      company: { verificationStatus: 'UNSUBMITTED', memberRole: 'OWNER', isActive: true },
    })
    await page.goto(`/zh/admin/companies/${company.id}`)
    await page.waitForLoadState('networkidle').catch(() => {})

    // Should be redirected away from the admin page
    expect(page.url()).not.toContain(`/admin/companies/${company.id}`)

    // Owner email must not appear on the page
    await expect(page.getByText(ownerEmail)).not.toBeVisible()
  })
})
