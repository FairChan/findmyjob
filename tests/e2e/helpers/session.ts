/**
 * loginAs — creates a synthetic user in the dev DB and logs in via /zh/login.
 *
 * Rate-limit note: Better Auth caps /sign-in/email at 5 req/min per IP (memory storage in dev).
 * With the current test count (< 5 logins per run) we stay within the limit. If future test
 * expansion pushes past that, switch to storageState: call loginAs once per configuration,
 * save context.storageState() to a temp file, and restore it in each test with
 *   browser.newContext({ storageState: file })
 * rather than logging in again. That avoids repeated logins while keeping per-test DB setup.
 */
import type { Page } from '@playwright/test'
import { faker } from '@faker-js/faker'
import { PrismaClient } from '@prisma/client'
import { hashPassword } from 'better-auth/crypto'
import { stubTurnstile } from './turnstile'

// Prisma 6 auto-loads .env from project root; do NOT read or log the connection string here.
const db = new PrismaClient()

const TEST_PASSWORD = 'TestPassword123!'

export type EmployerCompanyOpts = {
  verificationStatus?: 'UNSUBMITTED' | 'PENDING' | 'VERIFIED' | 'REJECTED'
  memberRole?: 'OWNER' | 'ADMIN' | 'RECRUITER'
  isActive?: boolean
}

export type LoginOpts =
  | { role: 'STUDENT' }
  | { role: 'EMPLOYER'; company?: EmployerCompanyOpts }
  | { role: 'ADMIN' }

export type LoginResult = {
  userId: string
  email: string
  companyId?: string
}

export async function loginAs(page: Page, opts: LoginOpts): Promise<LoginResult> {
  const unique = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
  const email = `e2e-${opts.role.toLowerCase()}-${unique}@example.test`
  const hashedPwd = await hashPassword(TEST_PASSWORD)

  const user = await db.user.create({
    data: {
      name: faker.person.fullName(),
      email,
      emailVerified: true,
      role: opts.role,
      status: 'ACTIVE',
    },
  })

  // Better Auth credential accounts: providerId='credential', accountId=userId
  await db.account.create({
    data: {
      userId: user.id,
      accountId: user.id,
      providerId: 'credential',
      password: hashedPwd,
    },
  })

  let companyId: string | undefined

  if (opts.role === 'EMPLOYER' && opts.company) {
    const {
      verificationStatus = 'UNSUBMITTED',
      memberRole = 'OWNER',
      isActive = true,
    } = opts.company
    const company = await db.company.create({
      data: {
        legalName: faker.company.name(),
        verificationStatus,
        isActive,
      },
    })
    await db.companyMember.create({
      data: { companyId: company.id, userId: user.id, role: memberRole },
    })
    companyId = company.id
  }

  await stubTurnstile(page)
  await page.goto('/zh/login')
  await page.fill('[name="email"]', email)
  await page.fill('[name="password"]', TEST_PASSWORD)

  // Wait for Turnstile stub to fire and enable submit
  await page.waitForFunction(
    () => {
      const btn = document.querySelector<HTMLButtonElement>('button[type="submit"]')
      return btn !== null && !btn.disabled
    },
    { timeout: 10000 },
  )
  await page.click('button[type="submit"]')

  // Wait until the browser leaves the login page
  await page.waitForURL((url) => !url.pathname.includes('/login'), { timeout: 15000 })

  return { userId: user.id, email, companyId }
}
