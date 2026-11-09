import { randomBytes, randomUUID } from 'node:crypto'
import { test, expect, type Page, type Response } from '@playwright/test'
import { PDFDocument } from 'pdf-lib'
import { uniqueClientIp } from './helpers/client-ip'
import { stubTurnstile } from './helpers/turnstile'

// Registration, verification links, cookies, and signed downloads must not be retained in artifacts.
test.use({ trace: 'off', screenshot: 'off', video: 'off' })

const MAILPIT_URL = process.env.MAILPIT_URL ?? 'http://127.0.0.1:8026'

type MailpitMessages = { messages?: Array<{ ID: string; To?: Array<{ Address: string }> }> }
type MailpitMessage = { HTML?: string; Text?: string }

async function readMailpit<T>(path: string): Promise<T | null> {
  try {
    const response = await fetch(`${MAILPIT_URL}${path}`, { signal: AbortSignal.timeout(5_000) })
    if (!response.ok) return null
    return await response.json() as T
  } catch {
    return null
  }
}

async function verifyRegistrationEmail(email: string) {
  let verificationUrl: string | undefined
  await expect.poll(async () => {
    const messages = await readMailpit<MailpitMessages>('/api/v1/messages')
    const message = messages?.messages?.find((item) => item.To?.some((recipient) => recipient.Address === email))
    if (!message) return false
    const body = await readMailpit<MailpitMessage>(`/api/v1/message/${encodeURIComponent(message.ID)}`)
    const match = (body?.HTML || body?.Text || '').match(/href="([^"]*verify-email[^"]*)"/)
    verificationUrl = match?.[1].replace(/&amp;/g, '&')
    return Boolean(verificationUrl)
  }, {
    message: 'The synthetic registration must receive a verification email',
    timeout: 30_000,
    intervals: [250, 500, 1_000],
  }).toBe(true)

  // Native fetch keeps the token-bearing URL out of Playwright's API call logs.
  let verified = false
  try {
    const response = await fetch(verificationUrl!, {
      redirect: 'manual',
      signal: AbortSignal.timeout(15_000),
    })
    const destination = response.headers.get('location')
    verified = response.status >= 200 && response.status < 400 &&
      (!destination || !new URL(destination, verificationUrl).searchParams.has('error'))
    await response.body?.cancel()
  } catch {
    verified = false
  }
  expect(verified, 'Email verification must succeed without exposing its token').toBe(true)
}

async function documentNonce(response: Response | null): Promise<string> {
  const policy = response ? await response.headerValue('content-security-policy') : null
  expect(Boolean(policy), 'The document response must enforce Content-Security-Policy').toBe(true)
  const scriptPolicy = policy?.match(/(?:^|;)\s*script-src\s+([^;]+)/)?.[1] ?? ''
  const nonces = [...scriptPolicy.matchAll(/'nonce-([^']+)'/g)].map((match) => match[1])
  expect(nonces.length, 'The enforced script policy must contain one nonce').toBe(1)
  expect(scriptPolicy.includes("'strict-dynamic'"), 'The script policy must use strict-dynamic').toBe(true)
  expect(scriptPolicy.includes("'self'"), 'The script policy must include self').toBe(true)
  expect(scriptPolicy.includes('challenges.cloudflare.com'), 'The script policy must include Turnstile').toBe(true)
  const scripts = (await response!.text()).match(/<script\b[^>]*>/gi) ?? []
  expect(scripts.length).toBeGreaterThan(0)
  expect(scripts.every((script) => script.match(/\snonce=["']([^"']+)["']/)?.[1] === nonces[0]),
    'Every script delivered in the original HTML must match its response nonce').toBe(true)
  return nonces[0]
}

async function observeCsp(page: Page) {
  const enforcedViolations: string[] = []
  let consoleErrors = 0
  await page.exposeBinding('__reportCspViolation', (_source, directive: unknown) => {
    enforcedViolations.push(typeof directive === 'string' && /^[a-z-]+$/.test(directive) ? directive : 'unknown')
  })
  await page.addInitScript(() => {
    const reportingWindow = window as unknown as Window & { __reportCspViolation: (directive: string) => Promise<void> }
    window.addEventListener('securitypolicyviolation', (event) => {
      if (event.disposition === 'enforce') {
        void reportingWindow.__reportCspViolation(event.effectiveDirective)
      }
    })
  })
  page.on('console', (message) => {
    if (message.type() === 'error' && /content security policy|content-security-policy|securitypolicyviolation/i.test(message.text())) {
      consoleErrors += 1
    }
  })

  return async (nonce: string, stage: string) => {
    const state = await page.evaluate((expectedNonce) => {
      const scripts = Array.from(document.scripts)
      const isFrameworkChunk = (script: HTMLScriptElement) => Boolean(script.src &&
        new URL(script.src).origin === location.origin &&
        new URL(script.src).pathname.startsWith('/_next/static/chunks/'))
      return {
        scriptCount: scripts.length,
        // Next's trusted runtime loads additional same-origin chunks during SPA
        // navigation. strict-dynamic permits these; the HTML scripts are checked
        // separately before any navigation, and application scripts still need nonce.
        missingScripts: scripts.filter((script) => !script.nonce && !isFrameworkChunk(script)).map((script) => ({
          path: script.src ? new URL(script.src).pathname : 'inline', id: script.id, type: script.type,
        })),
        mismatchedScripts: scripts.filter((script) => script.nonce && script.nonce !== expectedNonce && !isFrameworkChunk(script)).map((script) => ({
          path: script.src ? new URL(script.src).pathname : 'inline', id: script.id, type: script.type,
        })),
        overflow: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - window.innerWidth,
      }
    }, nonce)
    expect(state.scriptCount, `${stage}: document scripts must be present`).toBeGreaterThan(0)
    expect(state.missingScripts, `${stage}: every top-level script needs a nonce`).toEqual([])
    expect(state.mismatchedScripts, `${stage}: scripts must match the main document response nonce`).toEqual([])
    expect(state.overflow, `${stage}: the page must fit the viewport`).toBeLessThanOrEqual(2)
    expect(enforcedViolations, `${stage}: no enforced CSP violations`).toEqual([])
    expect(consoleErrors, `${stage}: no CSP console errors`).toBe(0)
  }
}

test('M7-T15 locale navigation preserves the document nonce for Turnstile', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 })
  await stubTurnstile(page)
  const checkPage = await observeCsp(page)
  const nonce = await documentNonce(await page.goto('/zh'))
  await expect.poll(() => page.evaluate(async () =>
    (await navigator.serviceWorker.getRegistration('/'))?.active?.state === 'activated'),
  { message: 'The existing same-origin service worker must remain available under CSP' }).toBe(true)
  await page.getByRole('button', { name: 'English', exact: true }).click()
  await expect(page).toHaveURL(/\/en$/)
  await page.locator('header a[href="/en/login"]').click()
  await expect(page).toHaveURL(/\/en\/login$/)
  await expect(page.locator('button[type="submit"]')).toBeEnabled({ timeout: 15_000 })
  expect(await page.locator('#cf-turnstile-script').evaluate((script, expected) => (script as HTMLScriptElement).nonce === expected, nonce)).toBe(true)
  await checkPage(nonce, 'locale navigation')
})

async function verifyStoredPdf(page: Page, previewPath: string, original: Buffer) {
  // The protected endpoint is safe to inspect; its signed Location is kept only in memory.
  const redirectResponse = await page.request.get(previewPath, { maxRedirects: 0 })
  expect(redirectResponse.status(), 'The owner must be able to preview the uploaded resume').toBe(302)
  const location = redirectResponse.headers().location
  expect(Boolean(location), 'The preview must resolve to a stored object').toBe(true)

  let downloaded: Buffer | null = null
  let isPdf = false
  try {
    const response = await fetch(location, { signal: AbortSignal.timeout(15_000) })
    isPdf = response.ok && (response.headers.get('content-type') ?? '').includes('application/pdf')
    if (isPdf) downloaded = Buffer.from(await response.arrayBuffer())
    else await response.body?.cancel()
  } catch {
    downloaded = null
  }
  expect(isPdf && downloaded !== null, 'The stored PDF must be downloadable').toBe(true)
  expect(downloaded?.equals(original), 'The stored PDF must retain the uploaded bytes').toBe(true)
  const document = await PDFDocument.load(downloaded!)
  expect(document.getPageCount(), 'The uploaded PDF must remain parseable').toBe(1)
}

for (const width of [375, 1280]) {
  test(`M7-T15 ${width}px: live Cloudflare test widget works under enforced CSP`, async ({ page }) => {
    await page.setViewportSize({ width, height: width === 375 ? 812 : 900 })
    const checkPage = await observeCsp(page)
    const nonce = await documentNonce(await page.goto('/zh/register/student'))
    // No route stub: exercise the real script and iframe with the public test site key.
    await expect(page.locator('button[type="submit"]')).toBeEnabled({ timeout: 30_000 })
    expect(page.frames().some((frame) => frame.url().startsWith('https://challenges.cloudflare.com/'))).toBe(true)
    expect(await page.locator('#cf-turnstile-script').evaluate((script, expected) =>
      (script as HTMLScriptElement).nonce === expected, nonce)).toBe(true)
    await checkPage(nonce, 'live Turnstile')
  })

  test(`M7-T15 ${width}px: enforced CSP supports registration through persisted resume upload`, async ({ page }) => {
    test.setTimeout(180_000)
    await page.setViewportSize({ width, height: width === 375 ? 812 : 900 })
    await page.setExtraHTTPHeaders({ 'x-real-ip': uniqueClientIp() })
    const checkPage = await observeCsp(page)
    // This exercises the external script under CSP; it does not simulate Cloudflare's iframe contents.
    await stubTurnstile(page)

    const email = `csp-upload-${randomUUID()}@example.test`
    const password = `Csp-${randomBytes(24).toString('hex')}-9a`
    let nonce = await documentNonce(await page.goto('/zh/register/student'))
    const firstNonce = nonce
    await expect(page.locator('button[type="submit"]')).toBeEnabled({ timeout: 15_000 })
    await checkPage(nonce, 'registration')

    nonce = await documentNonce(await page.reload())
    expect(nonce !== firstNonce, 'Two requests to the same page must receive different nonces').toBe(true)
    await expect(page.locator('button[type="submit"]')).toBeEnabled({ timeout: 15_000 })
    await checkPage(nonce, 'registration reload')

    await page.locator('[name="name"]').fill('CSP 上传测试同学')
    await page.locator('[name="email"]').fill(email)
    await page.locator('[name="password"]').fill(password)
    await page.locator('[name="agreeTerms"]').check()
    await page.locator('[name="agreePrivacy"]').check()
    await page.locator('button[type="submit"]').click()
    await expect(page).toHaveURL(/\/zh\/register\/verify-email$/, { timeout: 20_000 })
    await expect(page.getByRole('heading', { name: '请验证您的邮箱', exact: true })).toBeVisible()
    await checkPage(nonce, 'verification notice')
    await verifyRegistrationEmail(email)

    nonce = await documentNonce(await page.goto('/zh/login'))
    await expect(page.locator('button[type="submit"]')).toBeEnabled({ timeout: 15_000 })
    await checkPage(nonce, 'login')
    await page.locator('[name="email"]').fill(email)
    await page.locator('[name="password"]').fill(password)
    await page.locator('button[type="submit"]').click()
    await expect(page).toHaveURL(/\/zh\/s\/onboarding$/, { timeout: 20_000 })
    await expect(page.getByText('第 1 / 4 步', { exact: true })).toBeVisible()
    await checkPage(nonce, 'onboarding step 1')

    await page.locator('#fullName').fill('CSP 上传测试同学')
    await page.locator('#workAuth').selectOption('STUDENT_PASS')
    await page.getByRole('button', { name: '下一步', exact: true }).click()
    await expect(page.getByText('第 2 / 4 步', { exact: true })).toBeVisible()
    await checkPage(nonce, 'onboarding step 2')
    await page.getByRole('checkbox', { name: '实习', exact: true }).check()
    await page.getByRole('button', { name: '下一步', exact: true }).click()
    await expect(page.getByText('第 3 / 4 步', { exact: true })).toBeVisible()
    await checkPage(nonce, 'onboarding step 3')
    await page.getByRole('button', { name: '下一步', exact: true }).click()
    await expect(page.getByText('第 4 / 4 步', { exact: true })).toBeVisible()
    await checkPage(nonce, 'onboarding step 4')
    await page.getByRole('button', { name: '完成', exact: true }).click()
    await expect(page).toHaveURL(/\/zh\/s$/, { timeout: 15_000 })
    await checkPage(nonce, 'student dashboard')

    nonce = await documentNonce(await page.goto('/zh/s/resume'))
    await expect(page.getByRole('heading', { name: '我的简历', exact: true })).toBeVisible()
    await checkPage(nonce, 'resume before upload')
    const pdf = await PDFDocument.create()
    pdf.addPage([595, 842]).drawText('Synthetic resume for CSP upload test')
    const buffer = Buffer.from(await pdf.save())
    const fileName = `csp-resume-${width}.pdf`

    const uploadResponsePromise = page.waitForResponse((response) =>
      new URL(response.url()).pathname === '/api/uploads/RESUME' && response.request().method() === 'POST',
    )
    const fileChooserPromise = page.waitForEvent('filechooser')
    await page.getByRole('button', { name: '上传简历', exact: true }).and(page.locator('button')).click()
    const fileChooser = await fileChooserPromise
    await fileChooser.setFiles({ name: fileName, mimeType: 'application/pdf', buffer })
    const uploadResponse = await uploadResponsePromise
    expect(uploadResponse.status(), 'A valid PDF upload must succeed').toBe(200)
    const uploadResult = await uploadResponse.json() as { ok?: boolean }
    expect(uploadResult.ok, 'The upload handler must confirm persistence').toBe(true)

    const resumeRow = page.getByRole('list', { name: '我的简历', exact: true })
      .getByRole('listitem').filter({ hasText: fileName })
    await expect(resumeRow).toHaveCount(1)
    await expect(resumeRow.getByText('1 页', { exact: true })).toBeVisible()
    await checkPage(nonce, 'resume after upload')

    const beforeReloadNonce = nonce
    nonce = await documentNonce(await page.reload())
    expect(nonce !== beforeReloadNonce, 'The authenticated page reload must also rotate its nonce').toBe(true)
    await expect(resumeRow).toHaveCount(1)
    await expect(resumeRow.getByText(fileName, { exact: true })).toBeVisible()
    await checkPage(nonce, 'persisted resume after reload')
    const previewPath = await resumeRow.getByRole('link', { name: '预览', exact: true }).getAttribute('href')
    expect(Boolean(previewPath && /^\/api\/resumes\/[^/]+$/.test(previewPath)), 'The row must link to its protected preview').toBe(true)
    await verifyStoredPdf(page, previewPath!, buffer)

    page.once('dialog', (dialog) => { void dialog.accept() })
    await resumeRow.getByRole('button', { name: '删除', exact: true }).click()
    await expect(resumeRow).toHaveCount(0)
    await expect(page.getByText('还没有上传简历', { exact: true })).toBeVisible()
    await checkPage(nonce, 'resume after deletion')
    const deletedPreview = await page.request.get(previewPath!, { maxRedirects: 0 })
    expect(deletedPreview.status(), 'The deleted resume must no longer be available').toBe(404)
  })
}
