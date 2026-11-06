/**
 * Smoke tests for M3-T01 employer/company pages.
 * Verifies pages render without crashes after the M3 company module was added.
 */
import { test, expect } from '@playwright/test'
import { loginAs } from './helpers/session'
import { expectPageHealthy } from './helpers/smoke'

test.describe('M3 employer onboarding smoke', () => {
  test('EMPLOYER with no company: /zh/e/onboarding is healthy and /zh/e redirects there', async ({
    page,
  }) => {
    await loginAs(page, { role: 'EMPLOYER' })

    // Landing after login should already be /zh/e/onboarding; also assert it directly
    await expectPageHealthy(page, '/zh/e/onboarding')

    // Visiting /zh/e without a company should redirect to onboarding
    await expectPageHealthy(page, '/zh/e', { expectUrl: '/zh/e/onboarding' })
  })
})

test.describe('M3 company edit smoke', () => {
  test('OWNER of UNSUBMITTED company: /zh/e/company and /en/e/company are healthy', async ({
    page,
  }) => {
    await loginAs(page, {
      role: 'EMPLOYER',
      company: { verificationStatus: 'UNSUBMITTED', memberRole: 'OWNER', isActive: true },
    })

    await expectPageHealthy(page, '/zh/e/company')
    await expectPageHealthy(page, '/en/e/company')
  })
})
