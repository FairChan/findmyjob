/**
 * PII leak tests: verifies that sensitive student data never appears in unauthenticated or
 * unauthorized responses, and that locked job details do not expose description/requirements/
 * benefits/salary even for quota-exhausted students.
 *
 * M4-T13: talent-side PII leak – employer without unlock must not see fullName / contact /
 * storageKey in any HTML, RSC, or JSON response from /e/talent and /e/talent/[id].
 * M4-T22: strengthen test so free-text fields (headline, summary, education/experience
 * descriptions) contain real PII and are verifiably scanned; add interactions to also
 * capture RSC and Server Action responses.
 */
import { test, expect, type Page } from '@playwright/test'
import { randomUUID } from 'node:crypto'
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

/**
 * Collect HTML+JSON+RSC text from all responses for a single page.goto().
 * Stores every res.text() promise in an array and awaits them all after networkidle,
 * so bodies resolved just before networkidle are never lost.
 * networkidle timeout is NOT swallowed — an unexpected timeout is a real test failure.
 */
async function collectPageText(page: Page, path: string): Promise<string[]> {
  const pending: Promise<void>[] = []
  const collected: string[] = []
  page.on('response', (res) => {
    const ct = res.headers()['content-type'] ?? ''
    if (ct.includes('text/html') || ct.includes('application/json') || ct.includes('text/x-component')) {
      // Use res.body() + toString('utf8') because RSC text/x-component responses
      // may omit charset in Content-Type, causing res.text() to default to Latin-1.
      pending.push(
        res.body().then((buf) => { collected.push(buf.toString('utf8')) }).catch(() => {})
      )
    }
  })
  await page.goto(path)
  await page.waitForLoadState('networkidle')
  await Promise.allSettled(pending)
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
      data: { name: 'PII Corp Owner', email: `pii-owner-${randomUUID()}@example.test`, emailVerified: true, role: 'EMPLOYER', status: 'ACTIVE' },
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
      data: { name: 'PII Lock Owner', email: `pii-lock-owner-${randomUUID()}@example.test`, emailVerified: true, role: 'EMPLOYER', status: 'ACTIVE' },
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
      data: { name: 'quota filler', email: `qf-${randomUUID()}@example.test`, emailVerified: true, role: 'EMPLOYER', status: 'ACTIVE' },
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

// ─── M4-T22 (strengthened M4-T13): talent-side PII leak ──────────────────────
//
// M4-T13 original problem: the sentinel student had no free-text (no headline,
// summary, education/experience descriptions), so redact() was never called with
// real PII. Serializer bugs that leaked contact data through free-text fields
// (headline, summary, edu/exp descriptions) would not be detected.
//
// Fix verified in M4-T22 (red-run result):
//   Temporarily reverted toTalentCard.headline to `profile.headline` (no redaction).
//   Test failed at the phone assertion with:
//
//   Error: expect(received).not.toContain(expected) // indexOf
//   Expected substring: not "+60 12-000 0420"
//   Received string: "<!DOCTYPE html>...[broken headline: 联系 +60 12-000 0420 ...]..."
//
//   The serializer was then restored and all assertions pass.

test.describe('PII leak – talent search/detail (M4-T22, free-text coverage + interactions)', () => {
  let piiStudentId: string
  let piiStudentUserId: string
  let piiStudentAccountEmail: string
  const extraStudents: { userId: string; profileId: string }[] = []

  // 7 distinct sentinel contact values (WhatsApp ≠ phone)
  const WHATSAPP_SENTINEL = '+60 11-000 0421'
  const WECHAT_SENTINEL = 'pii-m4t13-wechat-sentinel'
  const STORAGE_KEY_SENTINEL = 'resumes/pii-m4t13-sentinel/cv.pdf'
  const LINKEDIN_SENTINEL = 'https://www.linkedin.com/in/pii-m4t13-sentinel'

  test.beforeAll(async () => {
    const { piiKeys, activeKeyId } = loadPiiKeys()

    // randomUUID() prevents P2002 collisions in fullyParallel workers
    piiStudentAccountEmail = `pii-talent-${randomUUID()}@example.test`

    const studentUser = await e2eDb.user.create({
      data: {
        name: SENTINEL.name,
        email: piiStudentAccountEmail,
        emailVerified: true,
        role: 'STUDENT',
        status: 'ACTIVE',
      },
    })
    piiStudentUserId = studentUser.id

    const school = await e2eDb.school.findFirst({ where: { active: true } })

    // Headline and summary contain the 7 PII values so redact() is exercised on them.
    const profile = await e2eDb.studentProfile.create({
      data: {
        userId: studentUser.id,
        fullName: SENTINEL.name,
        headline: `联系 ${SENTINEL.phone} ${SENTINEL.email}`,
        summary: `我是${SENTINEL.name}，微信：${WECHAT_SENTINEL}，WhatsApp ${WHATSAPP_SENTINEL}，${LINKEDIN_SENTINEL}`,
        visibility: 'PUBLIC',
        completeness: 80,
        schoolId: school?.id ?? null,
        schoolVerifiedAt: new Date(),
        skills: ['Python', 'React'],
        intents: ['INTERNSHIP'],
        // Future lastActiveAt ensures this student is first in the lastActive sort.
        lastActiveAt: new Date(Date.now() + 60_000),
      },
    })
    piiStudentId = profile.id

    // Encrypt sentinel contact values with the same AAD scheme as contact-access.ts.
    const aad = (field: string) => `StudentContact.${field}:${piiStudentId}`
    await e2eDb.studentContact.create({
      data: {
        studentId: piiStudentId,
        phone: encryptWithKeyring(SENTINEL.phone, aad('phone'), piiKeys, activeKeyId),
        email: encryptWithKeyring(SENTINEL.email, aad('email'), piiKeys, activeKeyId),
        whatsapp: encryptWithKeyring(WHATSAPP_SENTINEL, aad('whatsapp'), piiKeys, activeKeyId),
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

    // Education description contains full name + phone + email.
    await e2eDb.education.create({
      data: {
        studentId: piiStudentId,
        schoolName: 'Test University',
        description: `${SENTINEL.name}，联系 ${SENTINEL.phone}，${SENTINEL.email}`,
        sortOrder: 0,
      },
    })

    // Experience description contains full name + phone + email.
    await e2eDb.experience.create({
      data: {
        studentId: piiStudentId,
        kind: 'INTERNSHIP',
        title: 'Software Intern',
        organization: 'Test Corp',
        description: `姓名：${SENTINEL.name}，手机：${SENTINEL.phone}，邮箱：${SENTINEL.email}`,
        sortOrder: 0,
      },
    })

    // Create 20 extra PUBLIC students (schoolVerified, Python skill) so page 2 exists.
    for (let i = 0; i < 20; i++) {
      const extraUser = await e2eDb.user.create({
        data: {
          name: `Extra Student ${i}`,
          email: `extra-${randomUUID()}@example.test`,
          emailVerified: true,
          role: 'STUDENT',
          status: 'ACTIVE',
        },
      })
      const extraProfile = await e2eDb.studentProfile.create({
        data: {
          userId: extraUser.id,
          fullName: `Extra Student ${i}`,
          visibility: 'PUBLIC',
          completeness: 65,
          schoolId: school?.id ?? null,
          schoolVerifiedAt: new Date(),
          skills: ['Python'],
          lastActiveAt: new Date(),
        },
      })
      extraStudents.push({ userId: extraUser.id, profileId: extraProfile.id })
    }
  })

  test.afterAll(async () => {
    if (piiStudentId) {
      await e2eDb.education.deleteMany({ where: { studentId: piiStudentId } })
      await e2eDb.experience.deleteMany({ where: { studentId: piiStudentId } })
      await e2eDb.studentContact.deleteMany({ where: { studentId: piiStudentId } })
      await e2eDb.resumeFile.deleteMany({ where: { studentId: piiStudentId } })
      await e2eDb.studentProfile.deleteMany({ where: { id: piiStudentId } })
    }
    if (piiStudentUserId) {
      await e2eDb.user.deleteMany({ where: { id: piiStudentUserId } })
    }
    for (const { profileId, userId } of extraStudents) {
      await e2eDb.studentProfile.deleteMany({ where: { id: profileId } })
      await e2eDb.user.deleteMany({ where: { id: userId } })
    }
  })

  test(
    'search+detail: verified employer (no unlock) sees no PII in any response (RSC+SA included)',
    async ({ browser }) => {
      test.setTimeout(120_000)
      const ctx = await browser.newContext({ storageState: VERIFIED_STATE })
      const page = await ctx.newPage()
      try {
        const pending: Promise<void>[] = []
        const bodies: string[] = []
        let htmlCount = 0

        page.on('response', (res) => {
          const ct = res.headers()['content-type'] ?? ''
          if (ct.includes('text/html') || ct.includes('application/json') || ct.includes('text/x-component')) {
            if (ct.includes('text/html')) htmlCount++
            // Use buf.toString('utf8') — RSC responses may omit charset so res.text() defaults to Latin-1.
            pending.push(
              res.body().then((buf) => { bodies.push(buf.toString('utf8')) }).catch(() => {})
            )
          }
        })

        // 1. Initial list page (HTML): pii student is first (future lastActiveAt)
        await page.goto('/zh/e/talent')
        await page.waitForLoadState('networkidle')

        // Positive: list page renders (not error boundary)
        await expect(page.locator('h1').first()).toBeVisible()
        // Positive: pii student card link visible on page 1
        await expect(page.locator(`a[href*="/e/talent/${piiStudentId}"]`).first()).toBeVisible()

        // 2. Navigate to page 2 (RSC response)
        await page.getByRole('link', { name: '下一页' }).click()
        await page.waitForLoadState('networkidle')

        // 3. Navigate back to page 1 (RSC response — "navigate back")
        await page.getByRole('link', { name: '上一页' }).click()
        await page.waitForLoadState('networkidle')

        // 4. Submit keyword search "Python" via filter panel (router.push → RSC response)
        await page.locator('#filter-keyword').waitFor({ state: 'visible' })
        await page.locator('#filter-keyword').fill('Python')
        await page.keyboard.press('Enter')
        await page.waitForLoadState('networkidle')

        // 5. Click pii student card link (client-side navigation → RSC detail response)
        // pii student is first in keyword results (future lastActiveAt)
        await page.locator(`a[href*="/e/talent/${piiStudentId}"]`).first().click()
        await page.waitForURL(`**/e/talent/${piiStudentId}`)
        await page.waitForLoadState('networkidle')

        // 5a. DOM: masking is visible in rendered page — encoding-safe check (Playwright's
        //     Unicode DOM bypasses RSC text/x-component charset issues).
        //     Passes even with broken headline: summary is independently redacted.
        // Summary section paragraph contains redacted content (summary is never broken in this test).
        await expect(page.locator('[aria-labelledby="summary-heading"] p')).toContainText('[已隐藏]')

        // 6. Open SaveToFolder dialog (triggers server action – folders list)
        await page.locator('button[aria-haspopup="dialog"]').first().click()
        await page.locator('[role="dialog"]').waitFor({ state: 'visible' })
        await page.keyboard.press('Escape')
        await page.locator('[role="dialog"]').waitFor({ state: 'hidden' })

        // 7. Open unlock confirm dialog — do NOT confirm
        await page.locator('[data-testid="unlock-button"]').click()
        await page.locator('[role="dialog"]').waitFor({ state: 'visible' })
        await page.keyboard.press('Escape')

        await Promise.allSettled(pending)

        const all = bodies.join('\n')

        // ── Positive assertions ──

        // At least 1 HTML response collected
        expect(htmlCount).toBeGreaterThan(0)
        // Sentinel student id appears in responses (ASCII, encoding-safe)
        expect(all).toContain(piiStudentId)
        // Note: [已隐藏] in responses is verified via DOM check (step 5a) above;
        // RSC text/x-component bodies may have charset issues in res.body().

        // ── Negative: 7 PII values must not appear in any form ──
        // Run BEFORE the h1 check so a broken serializer is caught here first.

        // 1. Full name
        expect(all).not.toContain(SENTINEL.name)
        // 2. Phone — plus E.164 and digits-only forms
        expect(all).not.toContain(SENTINEL.phone)
        expect(all).not.toContain('+601200000420')  // E.164 (+CC digits)
        expect(all).not.toContain('601200000420')   // digits only
        // 3. Contact email
        expect(all).not.toContain(SENTINEL.email)
        // 4. WhatsApp (distinct from phone)
        expect(all).not.toContain(WHATSAPP_SENTINEL)
        // 5. WeChat handle + storage key + LinkedIn all share the 'pii-m4t13' prefix
        expect(all).not.toContain('pii-m4t13')
        // 6. Account email (User.email, never serialized to employer side)
        expect(all).not.toContain(piiStudentAccountEmail)

        // Positive: detail h1 shows masked name — checked last (live DOM assertion on
        // current page, which is the detail page at this point in the test)
        const h1Text = await page.locator('h1').first().textContent()
        expect(h1Text).toContain('哨同学')
        expect(h1Text).not.toContain(SENTINEL.name)
      } finally {
        await ctx.close()
      }
    },
  )
})
