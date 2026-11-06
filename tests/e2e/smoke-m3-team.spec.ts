/**
 * Smoke tests for M3-T04 team management pages.
 * Verifies /zh/e/team and /zh/e/team/accept render without crashes.
 */
import { test } from '@playwright/test'
import { createHash } from 'crypto'
import { loginAs } from './helpers/session'
import { expectPageHealthy } from './helpers/smoke'
import { e2eDb as db } from './helpers/db'

test.describe('M3-T04 team management smoke', () => {
  test('OWNER: /zh/e/team is healthy', async ({ page }) => {
    await loginAs(page, {
      role: 'EMPLOYER',
      company: { verificationStatus: 'UNSUBMITTED', memberRole: 'OWNER', isActive: true },
    })

    await expectPageHealthy(page, '/zh/e/team')
  })

  test('invited EMPLOYER: /zh/e/team/accept with valid token is healthy', async ({ page }) => {
    // Create the company owner separately (not logged in for this test)
    const ownerUser = await db.user.create({
      data: {
        name: 'Team Owner',
        email: `e2e-owner-team-${Date.now()}@example.test`,
        emailVerified: true,
        role: 'EMPLOYER',
        status: 'ACTIVE',
      },
    })
    const company = await db.company.create({
      data: { legalName: 'Smoke Team Co', verificationStatus: 'UNSUBMITTED', isActive: true },
    })
    await db.companyMember.create({
      data: { companyId: company.id, userId: ownerUser.id, role: 'OWNER' },
    })

    // Log in as the invited user
    const { email: inviteeEmail, userId: inviteeId } = await loginAs(page, { role: 'EMPLOYER' })

    // Create the invite in DB with the sha256 hash of a known token
    const rawToken = `smoke-test-token-${Date.now()}`
    const tokenHash = createHash('sha256').update(rawToken).digest('hex')
    await db.companyInvite.create({
      data: {
        companyId: company.id,
        email: inviteeEmail,
        role: 'ADMIN',
        tokenHash,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        createdById: ownerUser.id,
      },
    })

    await expectPageHealthy(page, `/zh/e/team/accept?token=${encodeURIComponent(rawToken)}`)
  })
})
