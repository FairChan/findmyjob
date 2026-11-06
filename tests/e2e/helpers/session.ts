/**
 * loginAs — creates a synthetic user in the dev DB and logs in via /zh/login.
 *
 * Rate-limit note: Better Auth caps /sign-in/email at 5 req/min per IP (memory storage in dev) and keys on
 * x-real-ip only. The full suite logs in ~20 times, so each loginAs sends its own x-real-ip from
 * 198.18.0.0/15 (see testClientIp) and behaves like a distinct client; the limit itself is not relaxed.
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

// Random address in 198.18.0.0/15 (RFC 2544 benchmarking range, never a real client).
function testClientIp(): string {
  const n = Math.floor(Math.random() * 2 ** 17)
  return `198.${18 + (n >> 16)}.${(n >> 8) & 255}.${n & 255}`
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

  // Each loginAs acts as its own client. Better Auth limits /sign-in/email to 5/min per IP and reads the IP only
  // from x-real-ip (written by Caddy in production; absent in local dev), so without this every test would share
  // one bucket and the full suite trips the limit. The limit itself is unchanged.
  await page.setExtraHTTPHeaders({ 'x-real-ip': testClientIp() })
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
