/**
 * PII leak tests: verifies that sensitive student data never appears in unauthenticated or
 * unauthorized responses, and that locked job details do not expose description/requirements/
 * benefits/salary even for quota-exhausted students.
 *
 * M4-T13: talent-side PII leak – employer without unlock must not see fullName / contact /
 * storageKey in any HTML, RSC, or JSON response from /e/talent and /e/talent/[id].
 */
import { test, expect, type Page } from '@playwright/test'
import { resolve } from 'node:path'
import { faker } from '@faker-js/faker'
import { loadEnvConfig } from '@next/env'
import { encryptWithKeyring } from '../../src/server/lib/crypto-core'
import { e2eDb } from './helpers/db'
import { loginAs } from './helpers/session'

// Load env vars with the same priority as Next.js dev server so PII_KEYS matches.
loadEnvConfig(process.cwd())

// Verified employer storageState (written by auth.setup.ts, depends on global-setup fixtures)
const VERIFIED_STATE = resolve(process.cwd(), 'tests/e2e/auth-verified.json')

function loadPiiKeys(): { piiKeys: string; activeKeyId: string } {
  const piiKeys = process.env.PII_KEYS
  if (!piiKeys) throw new Error('PII_KEYS not found in env (loadEnvConfig ran above)')
  return { piiKeys, activeKeyId: process.env.PII_ACTIVE_KEY_ID ?? 'v1' }
}

const SENTINEL = {
  name: '哨兵测试同学甲',
  phone: '+60 12-000 0420',
  email: 'leak-sentinel@example.test',
}

/** Collect HTML+JSON text from all responses after goto */
async function collectPageText(page: Page, path: string): Promise<string[]> {
  const collected: string[] = []
  page.on('response', async (res) => {
    const ct = res.headers()['content-type'] ?? ''
    if (ct.includes('text/html') || ct.includes('application/json') || ct.includes('text/x-component')) {
      try {
        const body = await res.text()
        collected.push(body)
      } catch {
        // stream already consumed
      }
    }
  })
  await page.goto(path)
  await page.waitForLoadState('networkidle').catch(() => {})
  return collected
}

test.describe('PII leak – job list (visitor)', () => {
  let jobId: string
  let companyId: string

  test.beforeAll(async () => {
    // Create a published job with sentinel data embedded in description
    const company = await e2eDb.company.create({
      data: {
        legalName: 'PII Test Corp',
        verificationStatus: 'VERIFIED',
        isActive: true,
      },
    })
    companyId = company.id
    const user = await e2eDb.user.create({
      data: { name: 'PII Corp Owner', email: `pii-owner-${Date.now()}@example.test`, emailVerified: true, role: 'EMPLOYER', status: 'ACTIVE' },
    })
    await e2eDb.companyMember.create({ data: { companyId, userId: user.id, role: 'OWNER' } })

    const job = await e2eDb.job.create({
      data: {
        companyId,
        createdById: user.id,
        title: 'PII Test Job',
        type: 'INTERNSHIP',
        description: `Secret description: ${SENTINEL.name} ${SENTINEL.phone}`,
        requirements: `Requirements with ${SENTINEL.email}`,
        benefits: 'Secret benefits 99999',
        salaryMin: 1000,
        salaryMax: 2000,
        salaryVisible: false,
        status: 'PUBLISHED',
        publishedAt: new Date(),
        workMode: 'ONSITE',
      },
    })
    jobId = job.id
  })

  test.afterAll(async () => {
    await e2eDb.job.deleteMany({ where: { companyId } })
    await e2eDb.companyMember.deleteMany({ where: { companyId } })
    await e2eDb.company.deleteMany({ where: { id: companyId } })
  })

  test('visitor /jobs list: no sentinel data, no hidden salary', async ({ page }) => {
    const bodies = await collectPageText(page as never, '/zh/jobs')
    const all = bodies.join('\n')
    expect(all).not.toContain(SENTINEL.name)
    expect(all).not.toContain(SENTINEL.phone)
    expect(all).not.toContain(SENTINEL.email)
    expect(all).not.toContain('Secret description')
    expect(all).not.toContain('Secret benefits')
    // Hidden salary formatted values must not appear on the list page
    // (raw integers like 1000/2000 are skipped because bundle hashes may contain them)
    expect(all).not.toContain('1,000')
    expect(all).not.toContain('2,000')
  })
})

test.describe('PII leak – locked job detail (quota exhausted student)', () => {
  let jobId: string
  let companyId: string

  test.beforeAll(async () => {
    const company = await e2eDb.company.create({
      data: {
        legalName: 'PII Lock Corp',
        verificationStatus: 'VERIFIED',
        isActive: true,
      },
    })
    companyId = company.id
    const owner = await e2eDb.user.create({
      data: { name: 'PII Lock Owner', email: `pii-lock-owner-${Date.now()}@example.test`, emailVerified: true, role: 'EMPLOYER', status: 'ACTIVE' },
    })
    await e2eDb.companyMember.create({ data: { companyId, userId: owner.id, role: 'OWNER' } })

    const job = await e2eDb.job.create({
      data: {
        companyId,
        createdById: owner.id,
        title: 'Locked Job Title',
        type: 'FULL_TIME',
        description: `LOCKED_DESCRIPTION_SENTINEL: ${SENTINEL.name}`,
        requirements: `LOCKED_REQUIREMENTS_SENTINEL: ${SENTINEL.phone}`,
        benefits: `LOCKED_BENEFITS_SENTINEL: ${SENTINEL.email}`,
        salaryMin: 5000,
        salaryMax: 8000,
        salaryVisible: true,
        status: 'PUBLISHED',
        publishedAt: new Date(),
        workMode: 'HYBRID',
      },
    })
    jobId = job.id
  })

  test.afterAll(async () => {
    await e2eDb.job.deleteMany({ where: { companyId } })
    await e2eDb.companyMember.deleteMany({ where: { companyId } })
    await e2eDb.company.deleteMany({ where: { id: companyId } })
  })

  test('quota-exhausted student sees locked card: no description/requirements/benefits', async ({ page }) => {
    // Login as student
    const { userId } = await loginAs(page, { role: 'STUDENT' })

    // Create student profile
    const school = await e2eDb.school.findFirst()
    const profile = await e2eDb.studentProfile.create({
      data: {
        userId,
        fullName: faker.person.fullName(),
        schoolId: school?.id ?? null,
        completeness: 50,
        visibility: 'PUBLIC',
      },
    })

    // Find the base quota limit (default 20) and exhaust it by pre-creating JobView records
    // for 20 distinct fake jobs (the student won't have opened any real job yet)
    const fakeCompany = await e2eDb.company.create({
      data: { legalName: 'Quota Exhaust Corp', verificationStatus: 'VERIFIED', isActive: true },
    })
    const quotaFiller = await e2eDb.user.create({
      data: { name: 'quota filler', email: `qf-${Date.now()}@example.test`, emailVerified: true, role: 'EMPLOYER', status: 'ACTIVE' },
    })
    await e2eDb.companyMember.create({ data: { companyId: fakeCompany.id, userId: quotaFiller.id, role: 'OWNER' } })

    for (let i = 0; i < 20; i++) {
      const fakeJob = await e2eDb.job.create({
        data: {
          companyId: fakeCompany.id,
          createdById: quotaFiller.id,
          title: `Fake Job ${i}`,
          type: 'INTERNSHIP',
          description: 'placeholder',
          status: 'PUBLISHED',
          publishedAt: new Date(),
          workMode: 'ONSITE',
        },
      })
      await e2eDb.jobView.create({ data: { studentId: profile.id, jobId: fakeJob.id } })
    }

    // Now navigate to the locked job detail
    const bodies = await collectPageText(page as never, `/zh/jobs/${jobId}`)
    const all = bodies.join('\n')

    // Locked card must not reveal description, requirements, benefits
    expect(all).not.toContain('LOCKED_DESCRIPTION_SENTINEL')
    expect(all).not.toContain('LOCKED_REQUIREMENTS_SENTINEL')
    expect(all).not.toContain('LOCKED_BENEFITS_SENTINEL')
    expect(all).not.toContain(SENTINEL.name)
    expect(all).not.toContain(SENTINEL.phone)
    expect(all).not.toContain(SENTINEL.email)

    // Clean up
    await e2eDb.jobView.deleteMany({ where: { studentId: profile.id } })
    await e2eDb.job.deleteMany({ where: { companyId: fakeCompany.id } })
    await e2eDb.companyMember.deleteMany({ where: { companyId: fakeCompany.id } })
    await e2eDb.company.deleteMany({ where: { id: fakeCompany.id } })
  })
})

// ─── M4-T13: talent-side PII leak ────────────────────────────────────────────
//
// A verified employer who has NOT unlocked the pii-sentinel student must not see
// any plaintext PII in HTML, RSC, or JSON responses from the talent pool pages.
//
// Verification that "故意让 serializer 漏出 phone 时，测试失败":
//   If talent-view.ts is changed so that `unlocked` is always true (simulating a
//   bug), getContactForCompany decrypts SENTINEL.phone and the response includes
//   the plaintext "+60 12-000 0420".  Both tests below would then fail on the
//   `not.toContain(SENTINEL.phone)` assertion.

test.describe('PII leak – talent search/detail (M4-T13, unlocked=false employer)', () => {
  let piiStudentId: string
  let piiStudentUserId: string

  // Unique sentinel values used only in this test block so other tests cannot
  // inadvertently satisfy/corrupt the assertions.
  const WECHAT_SENTINEL = 'pii-m4t13-wechat-sentinel'
  const STORAGE_KEY_SENTINEL = 'resumes/pii-m4t13-sentinel/cv.pdf'
  const LINKEDIN_SENTINEL = 'https://www.linkedin.com/in/pii-m4t13-sentinel'

  test.beforeAll(async () => {
    const { piiKeys, activeKeyId } = loadPiiKeys()

    const studentUser = await e2eDb.user.create({
      data: {
        name: SENTINEL.name,
        email: `pii-talent-${Date.now()}@example.test`,
        emailVerified: true,
        role: 'STUDENT',
        status: 'ACTIVE',
      },
    })
    piiStudentUserId = studentUser.id

    const school = await e2eDb.school.findFirst({ where: { active: true } })
    const profile = await e2eDb.studentProfile.create({
      data: {
        userId: studentUser.id,
        fullName: SENTINEL.name,
        visibility: 'PUBLIC',
        completeness: 80,
        schoolId: school?.id ?? null,
        schoolVerifiedAt: new Date(),
        skills: ['Python', 'React'],
        intents: ['INTERNSHIP'],
        lastActiveAt: new Date(),
      },
    })
    piiStudentId = profile.id

    // Encrypt sentinel contact values exactly as contact-access.ts does in
    // production (same AAD scheme: "StudentContact.<field>:<studentId>").
    const aad = (field: string) => `StudentContact.${field}:${piiStudentId}`
    await e2eDb.studentContact.create({
      data: {
        studentId: piiStudentId,
        phone: encryptWithKeyring(SENTINEL.phone, aad('phone'), piiKeys, activeKeyId),
        email: encryptWithKeyring(SENTINEL.email, aad('email'), piiKeys, activeKeyId),
        whatsapp: encryptWithKeyring(SENTINEL.phone, aad('whatsapp'), piiKeys, activeKeyId),
        wechat: encryptWithKeyring(WECHAT_SENTINEL, aad('wechat'), piiKeys, activeKeyId),
        linkedinUrl: encryptWithKeyring(LINKEDIN_SENTINEL, aad('linkedinUrl'), piiKeys, activeKeyId),
      },
    })

    await e2eDb.resumeFile.create({
      data: {
        studentId: piiStudentId,
        storageKey: STORAGE_KEY_SENTINEL,
        fileName: 'cv.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 1024,
        isPrimary: true,
      },
    })
  })

  test.afterAll(async () => {
    if (piiStudentId) {
      await e2eDb.studentContact.deleteMany({ where: { studentId: piiStudentId } })
      await e2eDb.resumeFile.deleteMany({ where: { studentId: piiStudentId } })
      await e2eDb.studentProfile.deleteMany({ where: { id: piiStudentId } })
    }
    if (piiStudentUserId) {
      await e2eDb.user.deleteMany({ where: { id: piiStudentUserId } })
    }
  })

  test(
    'talent search page: verified employer (no unlock) sees no PII in any response',
    async ({ browser }) => {
      const ctx = await browser.newContext({ storageState: VERIFIED_STATE })
      const page = await ctx.newPage()
      try {
        const bodies = await collectPageText(page, '/zh/e/talent')
        const all = bodies.join('\n')

        // Full name must be masked (toMaskName → '哨同学'), never appear verbatim
        expect(all).not.toContain(SENTINEL.name)
        // Decrypted contact values must not appear
        expect(all).not.toContain(SENTINEL.phone)
        expect(all).not.toContain(SENTINEL.email)
        expect(all).not.toContain(WECHAT_SENTINEL)
        // 'pii-m4t13' is a unique prefix shared by storageKey and linkedin sentinel
        expect(all).not.toContain('pii-m4t13')
      } finally {
        await ctx.close()
      }
    },
  )

  test(
    'talent detail page: verified employer (no unlock) sees no PII in any response',
    async ({ browser }) => {
      const ctx = await browser.newContext({ storageState: VERIFIED_STATE })
      const page = await ctx.newPage()
      try {
        // piiStudentId is set in beforeAll; test runs after beforeAll completes
        const bodies = await collectPageText(page, `/zh/e/talent/${piiStudentId}`)
        const all = bodies.join('\n')

        expect(all).not.toContain(SENTINEL.name)
        expect(all).not.toContain(SENTINEL.phone)
        expect(all).not.toContain(SENTINEL.email)
        expect(all).not.toContain(WECHAT_SENTINEL)
        expect(all).not.toContain('pii-m4t13')
        expect(all).not.toContain(STORAGE_KEY_SENTINEL)
      } finally {
        await ctx.close()
      }
    },
  )
})
