/**
 * A-22 E2E smoke test: admin company review page uses proxy route for documents.
 *
 * Verifies:
 * - Admin can open /zh/admin/companies/<id> (page is healthy)
 * - Document links point to /api/admin/verification-docs/... (not signed S3 URLs)
 * - Page HTML does not contain X-Amz-Signature or S3 signed URL parameters
 */
import { test, expect } from '@playwright/test'
import { loginAs } from './helpers/session'
import { expectPageHealthy } from './helpers/smoke'
import { e2eDb as db } from './helpers/db'

test.describe('A-22 admin company docs smoke', () => {
  test('ADMIN: company review page is healthy, doc links use proxy route, no S3 signed URLs', async ({
    page,
  }) => {
    const result = await loginAs(page, { role: 'ADMIN' })

    // Create a company in PENDING state with a fake document key
    const owner = await db.user.create({
      data: {
        name: 'DocOwner',
        email: `doc-owner-${Date.now()}@example.test`,
        emailVerified: true,
        role: 'EMPLOYER',
        status: 'ACTIVE',
      },
    })
    const company = await db.company.create({
      data: {
        legalName: 'A22 Smoke Test Co',
        verificationStatus: 'PENDING',
        isActive: true,
      },
    })
    await db.companyMember.create({
      data: { companyId: company.id, userId: owner.id, role: 'OWNER' },
    })
    const cv = await db.companyVerification.create({
      data: {
        companyId: company.id,
        documentKeys: [`verifications/${company.id}/ssm.pdf`],
        status: 'PENDING',
        submittedById: owner.id,
      },
    })
    void result
    void cv

    const url = `/zh/admin/companies/${company.id}`
    await expectPageHealthy(page, url)

    // All document links should point to the proxy route
    const docLinks = page.locator('a[href*="/api/admin/verification-docs/"]')
    const docLinkCount = await docLinks.count()
    expect(docLinkCount).toBeGreaterThan(0)

    // Page HTML must not contain S3 signed URL parameters
    const pageContent = await page.content()
    expect(pageContent).not.toContain('X-Amz-Signature')
    expect(pageContent).not.toContain('X-Amz-Credential')
    expect(pageContent).not.toContain('X-Amz-Algorithm')
  })
})
