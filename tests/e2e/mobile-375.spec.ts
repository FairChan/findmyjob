/**
 * M7-T08 mobile-375 E2E tests.
 *
 * Run with:
 *   pnpm exec playwright test tests/e2e/mobile-375.spec.ts --workers=1
 *
 * Coverage:
 * 1. PWA static files: manifest, icons, offline.html, sw.js.
 * 2. 375×812 layout checks for all specified pages:
 *    - No horizontal scroll (scrollWidth <= innerWidth).
 *    - Visible interactive elements (button, [role=button], nav a, input, select)
 *      are at least 24×24 px; inline text links in paragraphs are exempt (WCAG 2.2).
 */
import { test, expect, type Page, type BrowserContext } from '@playwright/test'
import { e2eDb as db } from './helpers/db'
import { loginAs } from './helpers/session'
import { expectPageHealthy } from './helpers/smoke'

test.describe.configure({ mode: 'serial' })

const VIEWPORT = { width: 375, height: 812 }

// Shared across describe blocks (set in public beforeAll, read in student section)
let sharedJobId = ''

// ---- reusable helpers ----

async function expectNoHScroll(page: Page, label: string): Promise<void> {
  const { sw, iw } = await page.evaluate(() => ({
    sw: document.documentElement.scrollWidth,
    iw: window.innerWidth,
  }))
  expect(
    sw,
    `${label}: scrollWidth ${sw} > innerWidth ${iw} (horizontal overflow)`,
  ).toBeLessThanOrEqual(iw)
}

async function expectMinTouchTargets(page: Page, label: string): Promise<void> {
  const violations = await page.evaluate(() => {
    const selector = 'button, [role="button"], nav a, input, select'
    const els = Array.from(document.querySelectorAll<HTMLElement>(selector))
    const result: string[] = []
    for (const el of els) {
      const style = window.getComputedStyle(el)
      if (style.display === 'none' || style.visibility === 'hidden') continue
      const rect = el.getBoundingClientRect()
      // Skip elements with no rendered size (off-DOM, zero-opacity, etc.)
      if (rect.width === 0 || rect.height === 0) continue
      // WCAG 2.2 exception: inline text links inside block text containers
      if (el.tagName === 'A' && el.closest('p, li, td, dd, dt')) continue
      if (rect.width < 24 || rect.height < 24) {
        result.push(
          `${el.tagName.toLowerCase()}[${(el.textContent ?? '').trim().slice(0, 30)}]` +
          `: ${Math.round(rect.width)}×${Math.round(rect.height)}px`,
        )
      }
    }
    return result
  })
  expect(
    violations,
    `${label}: touch-target violations:\n  ${violations.join('\n  ')}`,
  ).toHaveLength(0)
}

async function checkPage(page: Page, path: string): Promise<void> {
  await page.setViewportSize(VIEWPORT)
  await expectPageHealthy(page, path)
  await expectNoHScroll(page, path)
  await expectMinTouchTargets(page, path)
}

async function loginMobile(
  browser: Parameters<typeof test>[1] extends infer T
    ? T extends { browser: infer B } ? B : never
    : never,
  opts: Parameters<typeof loginAs>[1],
): Promise<{ ctx: BrowserContext; page: Page }> {
  const ctx = await (browser as import('@playwright/test').Browser).newContext({
    viewport: VIEWPORT,
  })
  const page = await ctx.newPage()
  await loginAs(page, opts)
  return { ctx, page }
}

// ── 1. PWA static files ──────────────────────────────────────────────────────

test.describe('PWA static files', () => {
  test('manifest.webmanifest returns 200 with required fields and valid icons', async ({
    request,
  }) => {
    const res = await request.get('/manifest.webmanifest')
    expect(res.status(), 'manifest HTTP status').toBe(200)

    const m = await res.json()
    expect(m.name, 'manifest name').toBe('FindMYJob')
    expect(m.start_url, 'manifest start_url').toBe('/zh')
    expect(m.display, 'manifest display').toBe('standalone')

    const icon192 = (m.icons as Array<{ sizes: string; src: string }>).find(
      (i) => i.sizes === '192x192',
    )
    expect(icon192, 'manifest 192 icon').toBeDefined()

    const icon512 = (m.icons as Array<{ sizes: string; src: string }>).find(
      (i) => i.sizes === '512x512',
    )
    expect(icon512, 'manifest 512 icon').toBeDefined()

    // Each icon file must be reachable and of type image/png
    for (const icon of m.icons as Array<{ src: string; sizes: string }>) {
      const iconRes = await request.get(icon.src)
      expect(iconRes.status(), `icon ${icon.src} HTTP status`).toBe(200)
      const ct = iconRes.headers()['content-type'] ?? ''
      expect(ct, `icon ${icon.src} content-type`).toContain('image/png')
    }
  })

  test('offline.html returns 200', async ({ request }) => {
    const res = await request.get('/offline.html')
    expect(res.status()).toBe(200)
  })

  test('sw.js returns 200', async ({ request }) => {
    const res = await request.get('/sw.js')
    expect(res.status()).toBe(200)
  })
})

// ── 2. Public pages ───────────────────────────────────────────────────────────

test.describe('public pages at 375px', () => {
  let pubCtx: BrowserContext
  let pubPage: Page
  let testJobId: string

  test.beforeAll(async ({ browser }) => {
    // Create a published job for /zh/jobs/[id] test
    const co = await db.company.create({
      data: { legalName: `M7T08-pub-co-${Date.now()}`, verificationStatus: 'VERIFIED', isActive: true },
    })
    const owner = await db.user.create({
      data: {
        name: 'M7T08 PubOwner',
        email: `m7t08-pubowner-${Date.now()}@example.test`,
        emailVerified: true,
        role: 'EMPLOYER',
        status: 'ACTIVE',
      },
    })
    await db.companyMember.create({ data: { companyId: co.id, userId: owner.id, role: 'OWNER' } })
    const job = await db.job.create({
      data: {
        companyId: co.id,
        createdById: owner.id,
        title: 'M7T08 Public Job',
        type: 'INTERNSHIP',
        description: 'Mobile layout smoke test',
        status: 'PUBLISHED',
        publishedAt: new Date(),
        workMode: 'HYBRID',
      },
    })
    testJobId = job.id
    sharedJobId = job.id

    pubCtx = await browser.newContext({ viewport: VIEWPORT })
    pubPage = await pubCtx.newPage()
  })

  test.afterAll(async () => {
    await pubCtx?.close()
  })

  test('/zh', async () => { await checkPage(pubPage, '/zh') })
  test('/zh/jobs', async () => { await checkPage(pubPage, '/zh/jobs') })
  test('/zh/companies', async () => { await checkPage(pubPage, '/zh/companies') })
  test('/zh/for-employers', async () => { await checkPage(pubPage, '/zh/for-employers') })
  test('/zh/partners', async () => { await checkPage(pubPage, '/zh/partners') })
  test('/zh/login', async () => { await checkPage(pubPage, '/zh/login') })
  test('/zh/register/student', async () => { await checkPage(pubPage, '/zh/register/student') })
})

// ── 3. Student pages ──────────────────────────────────────────────────────────

test.describe('student pages at 375px', () => {
  let sCtx: BrowserContext
  let sPage: Page
  let sJobId: string

  test.beforeAll(async ({ browser }) => {
    sCtx = await browser.newContext({ viewport: VIEWPORT })
    sPage = await sCtx.newPage()
    const { userId } = await loginAs(sPage, { role: 'STUDENT' })
    // loginAs does not create StudentProfile; upsert so profile-dependent pages work
    await db.studentProfile.upsert({
      where: { userId },
      create: {
        userId,
        fullName: 'M7T08 Student',
        visibility: 'HIDDEN',
        completeness: 60,
        workAuth: 'STUDENT_PASS',
        intents: ['INTERNSHIP'],
      },
      update: { completeness: 60 },
    })

    // Create a published job for the /zh/jobs/[id] detail page test
    const co = await db.company.create({
      data: { legalName: `M7T08-stu-co-${Date.now()}`, verificationStatus: 'VERIFIED', isActive: true },
    })
    const owner = await db.user.create({
      data: {
        name: 'M7T08 StuJobOwner',
        email: `m7t08-stujob-${Date.now()}@example.test`,
        emailVerified: true,
        role: 'EMPLOYER',
        status: 'ACTIVE',
      },
    })
    await db.companyMember.create({ data: { companyId: co.id, userId: owner.id, role: 'OWNER' } })
    const job = await db.job.create({
      data: {
        companyId: co.id,
        createdById: owner.id,
        title: 'M7T08 Student Job',
        type: 'INTERNSHIP',
        description: 'Mobile student job detail smoke test',
        status: 'PUBLISHED',
        publishedAt: new Date(),
        workMode: 'HYBRID',
      },
    })
    sJobId = job.id
    sharedJobId = job.id
  })

  test.afterAll(async () => {
    await sCtx?.close()
  })

  test('/zh/s', async () => { await checkPage(sPage, '/zh/s') })
  test('/zh/s/onboarding', async () => { await checkPage(sPage, '/zh/s/onboarding') })
  test('/zh/s/profile', async () => { await checkPage(sPage, '/zh/s/profile') })
  test('/zh/s/resume', async () => { await checkPage(sPage, '/zh/s/resume') })
  test('/zh/s/applications', async () => { await checkPage(sPage, '/zh/s/applications') })
  test('/zh/s/invitations', async () => { await checkPage(sPage, '/zh/s/invitations') })
  test('/zh/s/notifications', async () => { await checkPage(sPage, '/zh/s/notifications') })
  test('/zh/s/invite', async () => { await checkPage(sPage, '/zh/s/invite') })
  test('/zh/s/privacy', async () => { await checkPage(sPage, '/zh/s/privacy') })
  test('/zh/s/settings', async () => { await checkPage(sPage, '/zh/s/settings') })
  test('/zh/s/school-verify', async () => { await checkPage(sPage, '/zh/s/school-verify') })
  test('/zh/s/contact', async () => { await checkPage(sPage, '/zh/s/contact') })
  test('/zh/jobs/[id] (auth)', async () => { await checkPage(sPage, `/zh/jobs/${sJobId}`) })
})

// ── 4. Employer pages ─────────────────────────────────────────────────────────

test.describe('employer pages at 375px', () => {
  let eCtx: BrowserContext
  let ePage: Page
  let testJobId: string
  let testStudentId: string
  let testCompanyId: string
  let testFolderId: string

  test.beforeAll(async ({ browser }) => {
    // Create employer session with verified company
    eCtx = await browser.newContext({ viewport: VIEWPORT })
    ePage = await eCtx.newPage()
    const { companyId } = await loginAs(ePage, {
      role: 'EMPLOYER',
      company: { verificationStatus: 'VERIFIED' },
    })
    testCompanyId = companyId!

    // Get the employer user id from db
    const member = await db.companyMember.findFirst({
      where: { companyId: testCompanyId },
      select: { userId: true },
    })
    const empUserId = member!.userId

    // Create a published job for the applicants page
    const job = await db.job.create({
      data: {
        companyId: testCompanyId,
        createdById: empUserId,
        title: 'M7T08 Employer Job',
        type: 'INTERNSHIP',
        description: 'Mobile smoke',
        status: 'PUBLISHED',
        publishedAt: new Date(),
        workMode: 'HYBRID',
      },
    })
    testJobId = job.id

    // Create a student with profile for talent/[id] page
    const stuUser = await db.user.create({
      data: {
        name: 'M7T08 TalentUser',
        email: `m7t08-talent-${Date.now()}@example.test`,
        emailVerified: true,
        role: 'STUDENT',
        status: 'ACTIVE',
      },
    })
    const stuProfile = await db.studentProfile.create({
      data: {
        userId: stuUser.id,
        fullName: 'M7T08 TalentUser',
        visibility: 'PUBLIC',
        completeness: 60,
        schoolVerifiedAt: new Date(),
      },
    })
    testStudentId = stuProfile.id

    // Unlock the student so talent/[id] page loads without blocking
    await db.talentUnlock.create({
      data: {
        companyId: testCompanyId,
        studentId: testStudentId,
        unlockedById: empUserId,
        source: 'ADMIN',
        creditsSpent: 0,
      },
    })

    // Create a folder for folders/[id] check (not in task list but good to have)
    const folder = await db.talentFolder.create({
      data: { companyId: testCompanyId, name: 'M7T08 Folder', createdById: empUserId },
    })
    testFolderId = folder.id
  })

  test.afterAll(async () => {
    await eCtx?.close()
  })

  test('/zh/e', async () => { await checkPage(ePage, '/zh/e') })
  test('/zh/e/talent', async () => { await checkPage(ePage, '/zh/e/talent') })
  test('/zh/e/talent/[id]', async () => { await checkPage(ePage, `/zh/e/talent/${testStudentId}`) })
  test('/zh/e/jobs', async () => { await checkPage(ePage, '/zh/e/jobs') })
  test('/zh/e/jobs/new', async () => { await checkPage(ePage, '/zh/e/jobs/new') })
  test('/zh/e/jobs/[id]/applicants', async () => {
    await checkPage(ePage, `/zh/e/jobs/${testJobId}/applicants`)
  })
  test('/zh/e/folders', async () => { await checkPage(ePage, '/zh/e/folders') })
  test('/zh/e/invitations', async () => { await checkPage(ePage, '/zh/e/invitations') })
  test('/zh/e/notifications', async () => { await checkPage(ePage, '/zh/e/notifications') })
  test('/zh/e/company', async () => { await checkPage(ePage, '/zh/e/company') })
  test('/zh/e/team', async () => { await checkPage(ePage, '/zh/e/team') })
})

// ── 5. Admin pages ────────────────────────────────────────────────────────────

test.describe('admin pages at 375px', () => {
  let aCtx: BrowserContext
  let aPage: Page

  test.beforeAll(async ({ browser }) => {
    aCtx = await browser.newContext({ viewport: VIEWPORT })
    aPage = await aCtx.newPage()
    await loginAs(aPage, { role: 'ADMIN' })
  })

  test.afterAll(async () => {
    await aCtx?.close()
  })

  test('/zh/admin', async () => { await checkPage(aPage, '/zh/admin') })
  test('/zh/admin/companies', async () => { await checkPage(aPage, '/zh/admin/companies') })
  test('/zh/admin/jobs', async () => { await checkPage(aPage, '/zh/admin/jobs') })
  test('/zh/admin/students', async () => { await checkPage(aPage, '/zh/admin/students') })
  test('/zh/admin/settings', async () => { await checkPage(aPage, '/zh/admin/settings') })
  test('/zh/admin/data-requests', async () => { await checkPage(aPage, '/zh/admin/data-requests') })
  test('/zh/admin/notifications', async () => { await checkPage(aPage, '/zh/admin/notifications') })
})
