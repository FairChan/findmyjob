/**
 * M7-T07 全流程 E2E 冒烟
 *
 * Flow:
 *   学生注册 → 5 步资料（含联系方式和简历） → 认证学校 → 开启人才库 → 邀请同学
 *   企业注册 → 建公司 → 提交认证 → 运营通过
 *   搜人 → 解锁 → 学生收到通知
 *   企业发职位 → 审核 → 学生搜索+打开详情（扣额度）→ 投递 → 看板推进到 OFFER
 *
 * Run (3 consecutive passes required):
 *   pnpm exec playwright test tests/e2e/full-flow.spec.ts --workers=1
 */
import { test, expect } from '@playwright/test'
import { PDFDocument } from 'pdf-lib'
import { e2eDb as db } from './helpers/db'
import { loginAs } from './helpers/session'
import { stubTurnstile } from './helpers/turnstile'
import { uniqueClientIp } from './helpers/client-ip'
import { E2E_PASSWORD } from './helpers/password'

const MAILPIT_URL = process.env.MAILPIT_URL ?? 'http://127.0.0.1:8026'

async function fetchVerificationUrl(
  request: import('@playwright/test').APIRequestContext,
  email: string,
): Promise<string | null> {
  for (let i = 0; i < 20; i++) {
    await new Promise<void>((r) => setTimeout(r, 1000))
    const msgs = await request.get(`${MAILPIT_URL}/api/v1/messages`).catch(() => null)
    if (!msgs?.ok()) continue
    const json = await msgs.json()
    const msg = (json.messages as Array<{ ID: string; To: Array<{ Address: string }> }> ?? []).find(
      (m) => m.To?.some((to) => to.Address === email),
    )
    if (!msg) continue
    const msgBody = await request.get(`${MAILPIT_URL}/api/v1/message/${msg.ID}`).catch(() => null)
    if (!msgBody?.ok()) continue
    const body = await msgBody.json()
    const html: string = body.HTML ?? body.Text ?? ''
    const match = html.match(/href="([^"]*verify-email[^"]*)"/)
    if (match) return match[1].replace(/&amp;/g, '&')
  }
  return null
}

async function loginWithEmailPassword(
  page: import('@playwright/test').Page,
  email: string,
  password: string,
): Promise<void> {
  await page.setExtraHTTPHeaders({ 'x-real-ip': uniqueClientIp() })
  await stubTurnstile(page)
  await page.goto('/zh/login')
  await page.fill('[name="email"]', email)
  await page.fill('[name="password"]', password)
  await page.waitForFunction(
    () => {
      const btn = document.querySelector<HTMLButtonElement>('button[type="submit"]')
      return btn !== null && !btn.disabled
    },
    { timeout: 15000 },
  )
  await page.click('button[type="submit"]')
  await page.waitForURL((url) => !url.pathname.includes('/login'), { timeout: 20000 })
}

test.describe.serial('M7-T07 全流程 E2E 冒烟', () => {
  let studentUserId = ''
  let studentProfileId = ''
  let studentEmail = ''
  const studentPassword = E2E_PASSWORD
  let employerUserId = ''
  let employerCompanyId = ''
  let employerEmail = ''
  const employerPassword = E2E_PASSWORD
  let jobId = ''
  let applicationId = ''

  test.afterAll(async () => {
    if (applicationId) {
      await db.applicationEvent.deleteMany({ where: { applicationId } }).catch(() => {})
      await db.application.deleteMany({ where: { id: applicationId } }).catch(() => {})
    }
    if (jobId) {
      await db.jobView.deleteMany({ where: { jobId } }).catch(() => {})
      await db.job.deleteMany({ where: { id: jobId } }).catch(() => {})
    }
    if (employerCompanyId) {
      await db.talentUnlock.deleteMany({ where: { companyId: employerCompanyId } }).catch(() => {})
      await db.notification.deleteMany({ where: { type: 'talent.unlock', userId: studentUserId } }).catch(() => {})
      await db.creditLedger.deleteMany({ where: { wallet: { companyId: employerCompanyId } } }).catch(() => {})
      await db.creditWallet.deleteMany({ where: { companyId: employerCompanyId } }).catch(() => {})
      await db.companyVerification.deleteMany({ where: { companyId: employerCompanyId } }).catch(() => {})
      await db.companyMember.deleteMany({ where: { companyId: employerCompanyId } }).catch(() => {})
      await db.company.deleteMany({ where: { id: employerCompanyId } }).catch(() => {})
    }
    if (employerUserId) {
      await db.account.deleteMany({ where: { userId: employerUserId } }).catch(() => {})
      await db.consent.deleteMany({ where: { userId: employerUserId } }).catch(() => {})
      await db.user.deleteMany({ where: { id: employerUserId } }).catch(() => {})
    }
    if (studentProfileId) {
      await db.jobView.deleteMany({ where: { studentId: studentProfileId } }).catch(() => {})
      await db.studentProfile.deleteMany({ where: { id: studentProfileId } }).catch(() => {})
    }
    if (studentUserId) {
      await db.notification.deleteMany({ where: { userId: studentUserId } }).catch(() => {})
      await db.consent.deleteMany({ where: { userId: studentUserId } }).catch(() => {})
      await db.account.deleteMany({ where: { userId: studentUserId } }).catch(() => {})
      await db.user.deleteMany({ where: { id: studentUserId } }).catch(() => {})
    }
  })

  // ======== 学生段 ========

  test('S-1: student registers via UI + mailpit email verification', async ({ page, request }) => {
    const mailpitCheck = await request.get(`${MAILPIT_URL}/api/v1/messages`).catch(() => null)
    expect(mailpitCheck?.ok(), `Mailpit not reachable at ${MAILPIT_URL}`).toBe(true)

    await page.setExtraHTTPHeaders({ 'x-real-ip': uniqueClientIp() })
    await stubTurnstile(page)

    const unique = `${Date.now()}`
    studentEmail = `fullflow-student-${unique}@example.test`

    await page.goto('/zh/register/student')
    await page.fill('[name="name"]', '全流程测试同学')
    await page.fill('[name="email"]', studentEmail)
    await page.fill('[name="password"]', studentPassword)
    await page.check('[name="agreeTerms"]')
    await page.check('[name="agreePrivacy"]')
    await expect(page.locator('button[type="submit"]')).toBeEnabled({ timeout: 15000 })
    await page.click('button[type="submit"]')
    await expect(page).toHaveURL(/\/register\/verify-email/, { timeout: 20000 })

    const verifyUrl = await fetchVerificationUrl(request, studentEmail)
    expect(verifyUrl, `No verification email found for ${studentEmail} in Mailpit`).not.toBeNull()
    await page.goto(verifyUrl!)
    await page.waitForURL('**', { timeout: 10000 }).catch(() => {})

    // Login
    await loginWithEmailPassword(page, studentEmail, studentPassword)
    await expect(page).toHaveURL(/\/s\/onboarding/, { timeout: 15000 })

    // Store user and profile IDs
    const user = await db.user.findUnique({ where: { email: studentEmail } })
    expect(user, 'Student user should exist in DB after registration').not.toBeNull()
    studentUserId = user!.id

    const profile = await db.studentProfile.findUnique({ where: { userId: studentUserId } })
    expect(profile, 'Student profile should auto-created on registration').not.toBeNull()
    studentProfileId = profile!.id
  })

  test('S-2: student completes 5-step onboarding wizard', async ({ page }) => {
    await loginWithEmailPassword(page, studentEmail, studentPassword)
    await page.goto('/zh/s/onboarding')

    // Step 1: basic info
    await expect(page.getByText(/第 1 \/ 5 步/)).toBeVisible({ timeout: 10000 })
    await page.fill('[id="fullName"]', '全流程测试同学')
    await page.selectOption('[id="workAuth"]', 'STUDENT_PASS')
    await page.click('button:has-text("下一步")')
    await expect(page.getByText(/第 2 \/ 5 步/)).toBeVisible({ timeout: 10000 })

    // Step 2: job preferences
    const internshipCheckbox = page
      .locator('label')
      .filter({ hasText: '实习' })
      .locator('input[type="checkbox"]')
    if (await internshipCheckbox.count() > 0) await internshipCheckbox.check()
    await page.click('button:has-text("下一步")')
    await expect(page.getByText(/第 3 \/ 5 步/)).toBeVisible({ timeout: 10000 })

    // Step 3: skills & languages (skip)
    await page.click('button:has-text("下一步")')
    await expect(page.getByText(/第 4 \/ 5 步/)).toBeVisible({ timeout: 10000 })

    // Step 4: experience (skip)
    await page.click('button:has-text("下一步")')
    await expect(page.getByText(/第 5 \/ 5 步/)).toBeVisible({ timeout: 10000 })

    // Step 5: one contact method and a PDF resume are required before finishing
    await page.fill('#contact-email', 'full-flow-contact@example.test')
    const pdf = await PDFDocument.create()
    pdf.addPage().drawText('Synthetic full-flow resume')
    await page.locator('input[type="file"]').setInputFiles({
      name: 'full-flow-resume.pdf', mimeType: 'application/pdf', buffer: Buffer.from(await pdf.save()),
    })
    await expect(page.getByText('full-flow-resume.pdf', { exact: true })).toBeVisible({ timeout: 20_000 })
    await page.click('button:has-text("完成")')
    await page.waitForURL('**/s/jobs', { timeout: 15000 })
  })

  test('S-3: student school-verify (via DB) + enables talent pool on /s/privacy', async ({ page }) => {
    // Set school verified and profile data via DB (school email verification flow is complex UI)
    const school = await db.school.findFirst({ where: { active: true } })
    await db.studentProfile.update({
      where: { id: studentProfileId },
      data: {
        schoolId: school?.id ?? null,
        schoolVerifiedAt: new Date(),
        completeness: 70,
        skills: ['Python', 'React'],
        intents: ['INTERNSHIP'],
        workAuth: 'STUDENT_PASS',
      },
    })

    // Enable talent pool via UI on /s/privacy
    await loginWithEmailPassword(page, studentEmail, studentPassword)
    await page.goto('/zh/s/privacy')
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 10000 })

    // The toggle role="switch" with id="talent-pool-toggle"
    const toggle = page.locator('[role="switch"]#talent-pool-toggle')
    await expect(toggle).toBeVisible({ timeout: 10000 })
    const isChecked = (await toggle.getAttribute('aria-checked')) === 'true'
    if (!isChecked) {
      await toggle.click()
      await page.waitForTimeout(1500)
    }

    // Verify visibility is PUBLIC in DB
    await expect
      .poll(
        async () => {
          const p = await db.studentProfile.findUnique({
            where: { id: studentProfileId },
            select: { visibility: true },
          })
          return p?.visibility
        },
        { timeout: 10000, intervals: [500, 1000] },
      )
      .toBe('PUBLIC')
  })

  test('S-4: smoke /s/invite — page healthy, quota display visible', async ({ page }) => {
    await loginWithEmailPassword(page, studentEmail, studentPassword)
    await page.goto('/zh/s/invite')
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 10000 })
    // Quota display is present (even if unlimited or 0/20)
    await expect(page.getByText(/已使用/)).toBeVisible({ timeout: 10000 })
  })

  // ======== 企业段 ========

  test('E-1: employer registers via UI + email verification + creates company via /e/onboarding', async ({ page, request }) => {
    await page.setExtraHTTPHeaders({ 'x-real-ip': uniqueClientIp() })
    await stubTurnstile(page)

    const unique = `${Date.now()}`
    employerEmail = `fullflow-employer-${unique}@example.test`

    await page.goto('/zh/register/employer')
    await page.fill('[name="name"]', '全流程测试企业')
    await page.fill('[name="email"]', employerEmail)
    await page.fill('[name="password"]', employerPassword)
    await page.check('[name="agreeTerms"]')
    await page.check('[name="agreePrivacy"]')
    await expect(page.locator('button[type="submit"]')).toBeEnabled({ timeout: 15000 })
    await page.click('button[type="submit"]')
    await expect(page).toHaveURL(/\/register\/verify-email/, { timeout: 20000 })

    const verifyUrl = await fetchVerificationUrl(request, employerEmail)
    expect(verifyUrl, `No verification email for ${employerEmail}`).not.toBeNull()
    await page.goto(verifyUrl!)
    await page.waitForURL('**', { timeout: 10000 }).catch(() => {})

    // Login → redirected to /e/onboarding (no company yet)
    await loginWithEmailPassword(page, employerEmail, employerPassword)
    await expect(page).toHaveURL(/\/e\/onboarding/, { timeout: 15000 })

    // Create company via onboarding form
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 10000 })
    await page.fill('[id="legalName"]', `全流程测试企业 ${Date.now()} Sdn Bhd`)
    await page.click('button[type="submit"]:has-text("创建企业")')
    // Lands on the jobs page, whose banner points at the next step (verification).
    await page.waitForURL('**/e/jobs', { timeout: 15000 })
    await expect(page.getByRole('link', { name: '立即提交认证' })).toBeVisible()

    // Store IDs
    const user = await db.user.findUnique({ where: { email: employerEmail } })
    expect(user).not.toBeNull()
    employerUserId = user!.id

    const member = await db.companyMember.findFirst({ where: { userId: employerUserId } })
    expect(member, 'Company member should exist after creating company').not.toBeNull()
    employerCompanyId = member!.companyId
  })

  test('E-2: verification submitted via DB + admin approves via UI', async ({ page }) => {
    // Create pending verification record via DB
    const verification = await db.companyVerification.create({
      data: {
        companyId: employerCompanyId,
        documentKeys: [`verifications/${employerCompanyId}/ssm.pdf`],
        status: 'PENDING',
        submittedById: employerUserId,
      },
    })
    await db.company.update({
      where: { id: employerCompanyId },
      data: { verificationStatus: 'PENDING' },
    })

    // Admin approves via UI
    await loginAs(page, { role: 'ADMIN' })
    await page.goto(`/zh/admin/companies/${employerCompanyId}`)
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 10000 })

    // Tick at least one channel and fill result
    const ssmCheckbox = page.locator('#ch-SSM')
    await expect(ssmCheckbox).toBeVisible({ timeout: 5000 })
    await ssmCheckbox.check()
    await page.fill('#verify-result', '全流程测试认证通过')

    // Click the approve submit inside the approve form
    await page.locator('form:has(#ch-SSM) button[type="submit"]').click()
    await page.waitForTimeout(3000)

    // Verify in DB
    await expect
      .poll(
        async () => {
          const co = await db.company.findUnique({ where: { id: employerCompanyId } })
          return co?.verificationStatus
        },
        { timeout: 15000, intervals: [1000] },
      )
      .toBe('VERIFIED')

    // Pilot credits are auto-granted on verification; no manual wallet creation needed.
    // Suppress unused var — verification ID not needed further
    void verification
  })

  // ======== 解锁+通知段 ========

  test('U-1: employer navigates to talent profile and unlocks student', async ({ page }) => {
    await loginWithEmailPassword(page, employerEmail, employerPassword)

    // Navigate directly to student profile
    await page.goto(`/zh/e/talent/${studentProfileId}`)
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 20000 })

    // Unlock button
    const unlockBtn = page.getByTestId('unlock-button')
    await expect(unlockBtn).toBeVisible({ timeout: 10000 })
    await unlockBtn.click()

    // Confirm dialog
    const dialog = page.locator('[role="dialog"]')
    await expect(dialog).toBeVisible({ timeout: 5000 })
    const confirmOk = dialog.getByRole('button', { name: '确认解锁' })
    await expect(confirmOk).toBeVisible({ timeout: 5000 })
    await confirmOk.click()

    // Page shows 已解锁 after unlock
    await expect(page.getByText('已解锁')).toBeVisible({ timeout: 15000 })
  })

  test('U-2: student sees "企业解锁了你的联系方式" on notification page', async ({ page }) => {
    await loginWithEmailPassword(page, studentEmail, studentPassword)
    await page.goto('/zh/s/notifications')
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 15000 })

    await expect(page.getByText('企业解锁了你的联系方式')).toBeVisible({ timeout: 10000 })
  })

  // ======== 职位段 ========

  test('J-1: employer posts job via UI', async ({ page }) => {
    await loginWithEmailPassword(page, employerEmail, employerPassword)
    await page.goto('/zh/e/jobs/new')
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 10000 })

    // Fill title (controlled input, use placeholder selector)
    await page.getByPlaceholder('例：软件工程师实习生').fill('全流程测试职位')

    // Fill description
    await page.getByPlaceholder('描述工作内容、职责等').fill('全流程端到端测试职位，要求熟悉 Python 和 React。')

    // Submit for review (requires verified company — which we just set)
    await page.click('button:has-text("提交审核")')
    await page.waitForTimeout(3000)

    // Find the created job
    await expect
      .poll(
        async () => {
          const j = await db.job.findFirst({
            where: { companyId: employerCompanyId, status: 'PENDING_REVIEW' },
            orderBy: { createdAt: 'desc' },
          })
          return j?.id ?? null
        },
        { timeout: 15000, intervals: [1000] },
      )
      .not.toBeNull()

    const job = await db.job.findFirst({
      where: { companyId: employerCompanyId, status: 'PENDING_REVIEW' },
      orderBy: { createdAt: 'desc' },
    })
    expect(job, 'Job should be created in DB with PENDING_REVIEW status').not.toBeNull()
    jobId = job!.id
  })

  test('J-2: admin approves job via UI', async ({ page }) => {
    await loginAs(page, { role: 'ADMIN' })
    await page.goto(`/zh/admin/jobs/${jobId}`)
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 10000 })

    await page.locator('button[type="submit"]:has-text("通过审核")').click()
    await page.waitForTimeout(3000)

    await expect
      .poll(
        async () => {
          const j = await db.job.findUnique({ where: { id: jobId } })
          return j?.status
        },
        { timeout: 15000, intervals: [1000] },
      )
      .toBe('PUBLISHED')
  })

  // ======== 学生搜索+投递段 ========

  test('A-1: student opens job detail — quota -1 in DB + invite page shows updated quota', async ({ page }) => {
    // Ensure apply threshold allows student
    await db.systemSetting.upsert({
      where: { key: 'apply.minCompleteness' },
      create: { key: 'apply.minCompleteness', value: 60 },
      update: { value: 60 },
    })

    await loginWithEmailPassword(page, studentEmail, studentPassword)

    // Record quota before opening job
    const quotaBefore = await db.jobView.count({ where: { studentId: studentProfileId } })

    // Open job detail
    await page.goto(`/zh/jobs/${jobId}`)
    await page.waitForLoadState('networkidle').catch(() => {})

    // Page should show job title (not locked)
    await expect(page.getByText('全流程测试职位')).toBeVisible({ timeout: 10000 })

    // DB quota must have increased by 1
    await expect
      .poll(
        async () => db.jobView.count({ where: { studentId: studentProfileId } }),
        { timeout: 15000, intervals: [500, 1000] },
      )
      .toBe(quotaBefore + 1)

    const quotaAfter = quotaBefore + 1

    // /s/invite page shows updated quota count (已使用 N / M 次 or 已使用 N 次)
    await page.goto('/zh/s/invite')
    await expect(page.getByText(new RegExp(`已使用 ${quotaAfter}`))).toBeVisible({ timeout: 10000 })
  })

  test('A-2: student applies to job', async ({ page }) => {
    await loginWithEmailPassword(page, studentEmail, studentPassword)
    await page.goto(`/zh/jobs/${jobId}`)
    await page.waitForLoadState('networkidle').catch(() => {})

    const applyBtn = page.getByRole('button', { name: /立即投递|Apply Now/i })
    await expect(applyBtn).toBeVisible({ timeout: 10000 })
    await applyBtn.click()

    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 5000 })
    await page.getByRole('button', { name: /确认投递|Submit Application/i }).click()

    // Applied badge visible
    await expect(page.getByRole('dialog')).not.toBeVisible({ timeout: 10000 })
    await expect(page.getByText(/已投递|Applied/i)).toBeVisible({ timeout: 10000 })

    // DB record
    const app = await db.application.findFirst({
      where: { studentId: studentProfileId, jobId },
    })
    expect(app, 'Application must exist in DB after applying').not.toBeNull()
    expect(app?.status).toBe('APPLIED')
    applicationId = app!.id
  })

  test('A-3: employer advances application to OFFER on kanban', async ({ page }) => {
    await loginWithEmailPassword(page, employerEmail, employerPassword)
    await page.goto(`/zh/e/jobs/${jobId}/applicants`)
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 10000 })

    // Switch to list view to access status select
    const listViewBtn = page.getByRole('button', { name: /标准化列表|Standardized List/i })
    await expect(listViewBtn).toBeVisible({ timeout: 5000 })
    await listViewBtn.click()

    const statusSelect = page.locator('select').first()
    await expect(statusSelect).toBeVisible({ timeout: 5000 })
    await statusSelect.selectOption('OFFER')
    // Outcome statuses email the student, so the board asks for confirmation first.
    const confirm = page.getByRole('dialog')
    await expect(confirm).toContainText('学生会立即收到站内通知和邮件')
    await confirm.getByRole('button', { name: '确认修改' }).click()

    // DB reflects OFFER
    await expect
      .poll(
        async () => {
          const a = await db.application.findUnique({ where: { id: applicationId } })
          return a?.status
        },
        { timeout: 15000, intervals: [500, 1000] },
      )
      .toBe('OFFER')

    // Reload and confirm kanban shows 已发 Offer (multiple elements may match — use first)
    await page.goto(`/zh/e/jobs/${jobId}/applicants`)
    await page.waitForLoadState('networkidle').catch(() => {})
    await expect(page.getByText(/已发 Offer/i).first()).toBeVisible({ timeout: 10000 })
  })
})
