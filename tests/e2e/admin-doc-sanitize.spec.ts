/**
 * M3-T07 E2E: an operator downloading a company's PDF verification document gets a sanitised
 * copy, never the original (A-22 / TM-016). The original stored in MinIO carries a JavaScript
 * /OpenAction; the downloaded copy must not.
 */
import { test, expect } from '@playwright/test'
import { PDFDocument, PDFName, PDFString } from 'pdf-lib'
import { loadEnvConfig } from '@next/env'
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3'
import { loginAs } from './helpers/session'
import { e2eDb as db } from './helpers/db'

// Same credential source as global-setup: process env first (the lane scripts export the local
// MinIO defaults), then .env via @next/env. Values are never printed.
const { combinedEnv: env } = loadEnvConfig(process.cwd())

async function pdfWithOpenAction(): Promise<Buffer> {
  const doc = await PDFDocument.create()
  doc.addPage([612, 792])
  const action = doc.context.obj({ S: 'JavaScript', JS: PDFString.of('app.alert(1)') })
  doc.catalog.set(PDFName.of('OpenAction'), action)
  return Buffer.from(await doc.save())
}

test.describe('M3-T07 sanitised verification documents', () => {
  test('ADMIN download of a PDF verification document is the sanitised copy', async ({ page }) => {
    await loginAs(page, { role: 'ADMIN' })

    const owner = await db.user.create({
      data: {
        name: 'SanitizeDocOwner',
        email: `sanitize-owner-${Date.now()}@example.test`,
        emailVerified: true,
        role: 'EMPLOYER',
        status: 'ACTIVE',
      },
    })
    const company = await db.company.create({
      data: { legalName: `M3T07 Sanitize Co ${Date.now()}`, verificationStatus: 'PENDING', isActive: true },
    })
    await db.companyMember.create({ data: { companyId: company.id, userId: owner.id, role: 'OWNER' } })
    const key = `verifications/${company.id}/ssm.pdf`
    const cv = await db.companyVerification.create({
      data: { companyId: company.id, documentKeys: [key], status: 'PENDING', submittedById: owner.id },
    })

    const original = await pdfWithOpenAction()
    // Precondition: the stored original really has the active content we expect to be removed.
    expect((await PDFDocument.load(original)).catalog.has(PDFName.of('OpenAction'))).toBe(true)

    const s3 = new S3Client({
      endpoint: env.S3_ENDPOINT,
      region: env.S3_REGION ?? 'us-east-1',
      credentials: { accessKeyId: env.S3_ACCESS_KEY_ID ?? '', secretAccessKey: env.S3_SECRET_ACCESS_KEY ?? '' },
      forcePathStyle: true,
    })
    await s3.send(new PutObjectCommand({
      Bucket: env.S3_BUCKET ?? 'findmyjob-files',
      Key: key,
      Body: original,
      ContentType: 'application/pdf',
    }))

    const res = await page.request.get(`/api/admin/verification-docs/${cv.id}/0`)
    expect(res.status()).toBe(200)
    expect(res.headers()['content-type']).toContain('application/pdf')
    expect(res.headers()['content-security-policy']).toBe("sandbox; default-src 'none'")
    expect(res.headers()['x-content-type-options']).toBe('nosniff')

    const body = await res.body()
    expect(body.equals(original), 'the original file must never be served').toBe(false)
    const served = await PDFDocument.load(body)
    expect(served.catalog.has(PDFName.of('OpenAction'))).toBe(false)
    expect(served.getPageCount()).toBe(1)
  })
})
