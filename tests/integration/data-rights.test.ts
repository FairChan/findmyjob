/**
 * Integration tests for M7-T03: PDPA data-rights (export / delete / purge).
 *
 * Covers:
 * - Export job: zip content complete, no companyNote
 * - Export email: no S3 domain or signed-URL params
 * - getExportDownloadRequest: own within 24h → ok; other user → NotFoundError; expired → NotFoundError
 * - requestDeletion: immediately hides from talent pool
 * - requestExport: 24h dedup returns existing request
 * - Purge: sentinel values removed, idempotent
 */
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'

vi.mock('@/server/auth', () => ({
  getSession: vi.fn(),
  auth: {},
}))

vi.mock('@/server/db', async () => {
  const { testDb } = await import('../setup/db')
  return { db: testDb }
})

vi.mock('@/lib/storage', () => ({
  putObject: vi.fn().mockResolvedValue(undefined),
  getObjectBytes: vi.fn().mockResolvedValue(Buffer.from('%PDF-1.4 dummy')),
  getSignedDownloadUrl: vi.fn().mockResolvedValue('https://cdn.example.test/signed-url'),
  getSignedDisplayUrl: vi.fn().mockResolvedValue('https://cdn.example.test/display'),
  getSignedUploadUrl: vi.fn().mockResolvedValue({ url: '', fields: {} }),
  deleteAllVersions: vi.fn().mockResolvedValue(undefined),
  SIGNED_URL_EXPIRES_SECONDS: 300,
}))

vi.mock('@/server/services/notify', () => ({
  sendNotificationEmail: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/server/services/notifications', () => ({
  createNotification: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/server/jobs/boss', () => ({
  sendBoss: { start: vi.fn().mockResolvedValue(undefined), send: vi.fn().mockResolvedValue(undefined) },
}))

vi.mock('@/env', () => ({
  env: {
    S3_ENDPOINT: 'http://minio.test:9000',
    S3_REGION: 'us-east-1',
    S3_BUCKET: 'findmyjob-test',
    S3_ACCESS_KEY_ID: 'test-key',
    S3_SECRET_ACCESS_KEY: 'test-secret',
    APP_URL: 'https://findmyjob.asia',
    APP_ENV: 'test',
  },
}))

// Mock AWS S3 client used by purge job
const mockS3Send = vi.fn().mockResolvedValue({ Versions: [], DeleteMarkers: [], IsTruncated: false })
vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: vi.fn().mockImplementation(function(this: Record<string, unknown>) { this.send = mockS3Send }),
  ListObjectVersionsCommand: vi.fn().mockImplementation(function(this: Record<string, unknown>, input: unknown) { this.input = input; this._type = 'ListObjectVersionsCommand' }),
  DeleteObjectsCommand: vi.fn().mockImplementation(function(this: Record<string, unknown>, input: unknown) { this.input = input; this._type = 'DeleteObjectsCommand' }),
}))

import { unzipSync } from 'fflate'
import { ApplicationStatus, JobStatus, JobType, WorkMode } from '@prisma/client'
import { setupTestDb, testDb } from '../setup/db'
import { createStudent, SENTINEL } from '../factories'
import { runExportUserData } from '@/server/jobs/export-user-data'
import { runPurgeDeletedAccounts } from '@/server/jobs/purge-deleted-accounts'
import { requestExport, requestDeletion, getExportDownloadRequest } from '@/server/services/data-rights'
import { renderEmailTemplate } from '@/server/email/templates'
import { putObject } from '@/lib/storage'
import { NotFoundError } from '@/server/errors'

setupTestDb()

beforeEach(() => {
  vi.clearAllMocks()
  mockS3Send.mockResolvedValue({ Versions: [], DeleteMarkers: [], IsTruncated: false })
})

// ---------------------------------------------------------------------------
// Export job: zip content complete, no companyNote
// ---------------------------------------------------------------------------

describe('export job: zip content', () => {
  it('zip contains user.json and applications.json; companyNote excluded', async () => {
    const { userId, profileId } = await createStudent(testDb)
    const req = await testDb.dataRequest.create({
      data: { userId, type: 'EXPORT', status: 'OPEN' },
    })

    // Create a company + job + application with companyNote (employer-side data)
    const company = await testDb.company.create({
      data: { legalName: 'DropNoteCo', isActive: true, verificationStatus: 'VERIFIED' },
    })
    const job = await testDb.job.create({
      data: {
        companyId: company.id,
        createdById: (await testDb.companyMember.findFirst({ where: { companyId: company.id } }))?.userId ?? userId,
        title: 'Intern',
        description: 'An internship position',
        status: JobStatus.PUBLISHED,
        type: JobType.INTERNSHIP,
        workMode: WorkMode.ONSITE,
      },
    })
    await testDb.application.create({
      data: {
        studentId: profileId,
        jobId: job.id,
        coverNote: 'my-cover-note',
        companyNote: 'recruiter-secret-note',
        status: ApplicationStatus.APPLIED,
      },
    })

    await runExportUserData({ requestId: req.id, userId })

    const putObjectMock = vi.mocked(putObject)
    expect(putObjectMock).toHaveBeenCalledOnce()
    const [storageKey, zipBuffer, contentType] = putObjectMock.mock.calls[0]
    expect(storageKey).toContain(`exports/${userId}/`)
    expect(storageKey).toContain(req.id)
    expect(contentType).toBe('application/zip')

    const files = unzipSync(new Uint8Array(zipBuffer))
    expect(files['user.json']).toBeDefined()
    expect(files['applications.json']).toBeDefined()
    expect(files['profile.json']).toBeDefined()

    const userJson = JSON.parse(new TextDecoder().decode(files['user.json']))
    expect(userJson.id).toBe(userId)

    const apps = JSON.parse(new TextDecoder().decode(files['applications.json']))
    expect(apps).toHaveLength(1)
    expect(apps[0].coverNote).toBe('my-cover-note')
    // companyNote must NOT appear in the export
    expect('companyNote' in apps[0]).toBe(false)

    const updated = await testDb.dataRequest.findUnique({ where: { id: req.id } })
    expect(updated?.status).toBe('DONE')
    expect(updated?.resultKey).toBeTruthy()
  })
})

// ---------------------------------------------------------------------------
// Export email: no S3 domain or signed-URL parameters
// ---------------------------------------------------------------------------

describe('export email: no S3 domain', () => {
  it('zh template contains only site link, no S3 params', () => {
    const result = renderEmailTemplate({
      template: 'data-export-ready',
      locale: 'zh',
      requestId: 'cltest123456789',
    })
    expect(result.html).toContain('/s/privacy/exports/cltest123456789')
    expect(result.html).not.toMatch(/X-Amz-Signature/)
    expect(result.html).not.toMatch(/amazonaws\.com/)
    expect(result.html).not.toMatch(/minio/)
    expect(result.text).not.toMatch(/X-Amz-Signature/)
  })

  it('en template contains only site link, no S3 params', () => {
    const result = renderEmailTemplate({
      template: 'data-export-ready',
      locale: 'en',
      requestId: 'cltest987654321',
    })
    expect(result.html).toContain('/s/privacy/exports/cltest987654321')
    expect(result.html).not.toMatch(/X-Amz-Signature/)
    expect(result.html).not.toMatch(/amazonaws\.com/)
    expect(result.text).not.toMatch(/X-Amz-Signature/)
  })
})

// ---------------------------------------------------------------------------
// getExportDownloadRequest
// ---------------------------------------------------------------------------

describe('getExportDownloadRequest', () => {
  it('own DONE request within 24h returns the request', async () => {
    const { userId } = await createStudent(testDb)
    const req = await testDb.dataRequest.create({
      data: {
        userId,
        type: 'EXPORT',
        status: 'DONE',
        resultKey: `exports/${userId}/req.zip`,
        resolvedAt: new Date(),
      },
    })

    const result = await getExportDownloadRequest({ userId }, req.id)
    expect(result?.id).toBe(req.id)
    expect(result?.resultKey).toBeTruthy()
  })

  it("another user's export → NotFoundError", async () => {
    const a = await createStudent(testDb)
    const b = await createStudent(testDb)
    const req = await testDb.dataRequest.create({
      data: {
        userId: b.userId,
        type: 'EXPORT',
        status: 'DONE',
        resultKey: `exports/${b.userId}/req.zip`,
        resolvedAt: new Date(),
      },
    })

    await expect(getExportDownloadRequest({ userId: a.userId }, req.id)).rejects.toBeInstanceOf(NotFoundError)
  })

  it('export older than 24h → NotFoundError', async () => {
    const { userId } = await createStudent(testDb)
    const ago25h = new Date(Date.now() - 25 * 60 * 60 * 1000)
    const req = await testDb.dataRequest.create({
      data: {
        userId,
        type: 'EXPORT',
        status: 'DONE',
        resultKey: `exports/${userId}/req.zip`,
        resolvedAt: ago25h,
      },
    })

    await expect(getExportDownloadRequest({ userId }, req.id)).rejects.toBeInstanceOf(NotFoundError)
  })

  it('still-OPEN export → returns null (pending state)', async () => {
    const { userId } = await createStudent(testDb)
    const req = await testDb.dataRequest.create({
      data: { userId, type: 'EXPORT', status: 'OPEN' },
    })

    const result = await getExportDownloadRequest({ userId }, req.id)
    expect(result).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// requestDeletion: student immediately hidden from talent pool
// ---------------------------------------------------------------------------

describe('requestDeletion: talent pool removal', () => {
  it('after deletion user is DELETED and profile is HIDDEN', async () => {
    const { userId, profileId } = await createStudent(testDb)
    await testDb.studentProfile.update({
      where: { id: profileId },
      data: { visibility: 'PUBLIC' },
    })

    await requestDeletion({ userId })

    const user = await testDb.user.findUnique({ where: { id: userId } })
    expect(user?.status).toBe('DELETED')
    expect(user?.deletedAt).toBeTruthy()

    const profile = await testDb.studentProfile.findUnique({ where: { id: profileId } })
    expect(profile?.visibility).toBe('HIDDEN')

    // Session revoked
    const sessions = await testDb.session.findMany({ where: { userId } })
    expect(sessions).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// requestExport: 24h dedup
// ---------------------------------------------------------------------------

describe('requestExport: deduplication', () => {
  it('second call within 24h returns the same requestId with existing=true', async () => {
    const { userId } = await createStudent(testDb)

    const first = await requestExport({ userId })
    expect(first.existing).toBe(false)

    const second = await requestExport({ userId })
    expect(second.requestId).toBe(first.requestId)
    expect(second.existing).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Purge job: sentinel values cleared, idempotent
// ---------------------------------------------------------------------------

describe('purge: PII cleared for deleted accounts', () => {
  it('sentinel values removed from all fields after purge', async () => {
    const { userId, profileId } = await createStudent(testDb, {
      name: SENTINEL.name,
      email: `sentinel-purge-${Date.now()}@example.test`,
    })

    // Set student profile sentinel values
    await testDb.studentProfile.update({
      where: { id: profileId },
      data: { fullName: SENTINEL.name, headline: 'sentinel-headline', summary: 'sentinel-summary', nationality: 'MY' },
    })

    // Create StudentContact with sentinel PII
    await testDb.studentContact.create({
      data: { studentId: profileId, phone: SENTINEL.phone, email: SENTINEL.email },
    })

    // Create Education with sentinel description
    await testDb.education.create({
      data: { studentId: profileId, schoolName: 'Test U', description: SENTINEL.name },
    })

    // Create Experience with sentinel description
    await testDb.experience.create({
      data: { studentId: profileId, kind: 'INTERNSHIP', title: 'Dev', organization: 'TestOrg', description: SENTINEL.name },
    })

    // Create a fake resume record
    await testDb.resumeFile.create({
      data: { studentId: profileId, storageKey: `resumes/${userId}/cv.pdf`, fileName: 'cv.pdf', mimeType: 'application/pdf', sizeBytes: 100, isPrimary: true },
    })

    // Soft-delete and backdate deletedAt to 31 days ago
    const thirtyOneDaysAgo = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000)
    await testDb.user.update({
      where: { id: userId },
      data: { status: 'DELETED', deletedAt: thirtyOneDaysAgo },
    })

    const { purged } = await runPurgeDeletedAccounts()
    expect(purged).toBe(1)

    // StudentContact deleted
    const contact = await testDb.studentContact.findUnique({ where: { studentId: profileId } })
    expect(contact).toBeNull()

    // ResumeFile records deleted
    const resumes = await testDb.resumeFile.findMany({ where: { studentId: profileId } })
    expect(resumes).toHaveLength(0)

    // User anonymized — SENTINEL name and email gone
    const user = await testDb.user.findUnique({ where: { id: userId } })
    expect(user?.name).not.toContain(SENTINEL.name)
    expect(user?.email).not.toContain(SENTINEL.email)
    expect(user?.email).toMatch(/@purged\.internal$/)

    // StudentProfile anonymized
    const profile = await testDb.studentProfile.findUnique({ where: { id: profileId } })
    expect(profile?.fullName).not.toContain(SENTINEL.name)
    expect(profile?.headline).toBeNull()
    expect(profile?.summary).toBeNull()

    // Education description cleared
    const edus = await testDb.education.findMany({ where: { studentId: profileId } })
    for (const e of edus) {
      expect(e.description).toBeNull()
    }

    // Experience description cleared
    const exps = await testDb.experience.findMany({ where: { studentId: profileId } })
    for (const e of exps) {
      expect(e.description).toBeNull()
    }

    // S3 delete was attempted for exports prefix
    expect(mockS3Send).toHaveBeenCalled()

    // CreditLedger and AuditLog only have internal IDs — not PII
    // Verify the SENTINEL values are not in AuditLog (which should only have targetIds / internal refs)
    const auditLogs = await testDb.auditLog.findMany({ where: { actorId: userId } })
    for (const log of auditLogs) {
      const metaStr = JSON.stringify(log.metadata)
      expect(metaStr).not.toContain(SENTINEL.phone)
      expect(metaStr).not.toContain(SENTINEL.email)
    }
  })

  it('already-purged account (email @purged.internal) is skipped on second run', async () => {
    // Create an already-anonymised user (email ends @purged.internal)
    const thirtyOneDaysAgo = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000)
    await testDb.user.create({
      data: {
        name: 'Deleted User abc',
        email: `deleted-abc123@purged.internal`,
        emailVerified: false,
        role: 'STUDENT',
        status: 'DELETED',
        deletedAt: thirtyOneDaysAgo,
      },
    })

    const { purged } = await runPurgeDeletedAccounts()
    expect(purged).toBe(0)
  })
})
