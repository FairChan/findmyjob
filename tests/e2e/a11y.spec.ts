/**
 * Accessibility (a11y) smoke tests for M7-T17.
 *
 * Coverage: public pages, student pages (/s/*), employer pages (/e/*).
 *
 * Strategy:
 * - Each test asserts the page loads at the correct URL and has an h1.
 * - axe-core runs with WCAG 2.0/2.1 A/AA tags; only critical/serious violations
 *   fail the test. Moderate and minor issues are recorded in docs/A11Y.md.
 *
 * Session strategy:
 * - Public pages: no auth.
 * - Student pages: one loginAs(STUDENT) with a minimal StudentProfile.
 * - Employer pages: one loginAs(EMPLOYER, VERIFIED company).
 */
import { test, expect } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import os from 'node:os'
import path from 'node:path'
import { loginAs } from './helpers/session'
import { expectPageHealthy } from './helpers/smoke'
import { e2eDb as db } from './helpers/db'

type AxeViolation = Awaited<ReturnType<AxeBuilder['analyze']>>['violations'][number]

function formatViolations(violations: AxeViolation[]): string {
  if (violations.length === 0) return ''
  return violations
    .map(v => `  [${v.impact ?? 'unknown'}] ${v.id}: ${v.description} (${v.nodes.length} node(s))`)
    .join('\n')
}

function criticalOrSerious(violations: AxeViolation[]): AxeViolation[] {
  return violations.filter(v => v.impact === 'critical' || v.impact === 'serious')
}

// ---------------------------------------------------------------------------
// Public pages (no auth required)
// ---------------------------------------------------------------------------
test.describe('a11y: public pages', () => {
  const publicPages: { path: string; h1Pattern?: RegExp }[] = [
    { path: '/zh', h1Pattern: /找到我的第一份工作/ },
    { path: '/zh/for-employers' },
    { path: '/zh/partners' },
    { path: '/zh/jobs' },
    { path: '/zh/companies' },
  ]

  for (const { path: pagePath, h1Pattern } of publicPages) {
    test(`${pagePath} is accessible`, async ({ page }) => {
      await expectPageHealthy(page, pagePath)
      await expect(page).toHaveURL(new RegExp(pagePath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
      const h1 = page.getByRole('heading', { level: 1 })
      await expect(h1).toBeVisible()
      if (h1Pattern) {
        await expect(h1).toHaveText(h1Pattern)
      }
      const { violations } = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa'])
        .analyze()
      const critical = criticalOrSerious(violations)
      expect(critical, `Critical/serious a11y violations on ${pagePath}:\n${formatViolations(critical)}`).toHaveLength(0)
    })
  }
})

// ---------------------------------------------------------------------------
// Student pages (require STUDENT login with a StudentProfile)
// ---------------------------------------------------------------------------
test.describe('a11y: student pages', () => {
  let studentStatePath: string

  test.beforeAll(async ({ browser }) => {
    studentStatePath = path.join(os.tmpdir(), `a11y-student-${Date.now()}.json`)
    const ctx = await browser.newContext()
    const p = await ctx.newPage()
    const { userId } = await loginAs(p, { role: 'STUDENT' })
    // Create a minimal StudentProfile so dashboard pages render (not redirect to onboarding)
    await db.studentProfile.upsert({
      where: { userId },
      create: {
        userId,
        fullName: 'A11Y Test Student',
        onboardingStep: 5,
        completeness: 60,
        intents: ['INTERNSHIP'],
      },
      update: { onboardingStep: 5, completeness: 60 },
    })
    await ctx.storageState({ path: studentStatePath })
    await ctx.close()
  })

  const studentPages = [
    '/zh/s',
    '/zh/s/profile',
    '/zh/s/applications',
    '/zh/s/notifications',
    '/zh/s/privacy',
    '/zh/s/invite',
  ]

  for (const pagePath of studentPages) {
    test(`${pagePath} is accessible`, async ({ browser }) => {
      const ctx = await browser.newContext({ storageState: studentStatePath })
      const page = await ctx.newPage()
      try {
        await expectPageHealthy(page, pagePath)
        await expect(page).toHaveURL(new RegExp(pagePath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
        await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
        const { violations } = await new AxeBuilder({ page })
          .withTags(['wcag2a', 'wcag2aa'])
          .analyze()
        const critical = criticalOrSerious(violations)
        expect(critical, `Critical/serious a11y violations on ${pagePath}:\n${formatViolations(critical)}`).toHaveLength(0)
      } finally {
        await ctx.close()
      }
    })
  }
})

// ---------------------------------------------------------------------------
// Employer pages (require EMPLOYER login with VERIFIED company)
// ---------------------------------------------------------------------------
test.describe('a11y: employer pages', () => {
  let employerStatePath: string

  test.beforeAll(async ({ browser }) => {
    employerStatePath = path.join(os.tmpdir(), `a11y-employer-${Date.now()}.json`)
    const ctx = await browser.newContext()
    const p = await ctx.newPage()
    await loginAs(p, {
      role: 'EMPLOYER',
      company: { verificationStatus: 'VERIFIED', memberRole: 'OWNER' },
    })
    await ctx.storageState({ path: employerStatePath })
    await ctx.close()
  })

  const employerPages = [
    '/zh/e',
    '/zh/e/talent',
    '/zh/e/jobs',
    '/zh/e/company',
    '/zh/e/team',
    '/zh/e/notifications',
  ]

  for (const pagePath of employerPages) {
    test(`${pagePath} is accessible`, async ({ browser }) => {
      const ctx = await browser.newContext({ storageState: employerStatePath })
      const page = await ctx.newPage()
      try {
        await expectPageHealthy(page, pagePath)
        await expect(page).toHaveURL(new RegExp(pagePath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
        await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
        const { violations } = await new AxeBuilder({ page })
          .withTags(['wcag2a', 'wcag2aa'])
          .analyze()
        const critical = criticalOrSerious(violations)
        expect(critical, `Critical/serious a11y violations on ${pagePath}:\n${formatViolations(critical)}`).toHaveLength(0)
      } finally {
        await ctx.close()
      }
    })
  }
})
