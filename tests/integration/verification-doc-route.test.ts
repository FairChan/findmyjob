/**
 * Integration tests for A-22: /api/admin/verification-docs/[verificationId]/[index]
 * Verifies auth enforcement, 404 paths, 502 on S3 error, and audit log.
 */
import { vi, describe, it, expect, beforeEach } from 'vitest'

vi.mock('@/server/auth', () => ({
  getSession: vi.fn(),
  auth: {},
}))

vi.mock('@/server/db', async () => {
  const { testDb } = await import('../setup/db')
  return { db: testDb }
})

vi.mock('next/headers', () => ({
  headers: vi.fn().mockResolvedValue(new Headers()),
}))

// Mock S3 client
const mockS3Send = vi.fn()
vi.mock('@aws-sdk/client-s3', () => ({
  // Regular functions required: arrow functions cannot be used as constructors with `new`
  S3Client: vi.fn().mockImplementation(function () {
    return { send: mockS3Send }
  }),
  GetObjectCommand: vi.fn().mockImplementation(function (input: unknown) {
    return input
  }),
}))

import { setupTestDb, testDb } from '../setup/db'
import * as authMod from '@/server/auth'
import { Readable } from 'node:stream'
import { GET } from '@/app/api/admin/verification-docs/[verificationId]/[index]/route'

setupTestDb()

function mockSession(userId: string | null, role: string = 'ADMIN') {
  if (userId === null) {
    vi.mocked(authMod.getSession).mockResolvedValue(null)
  } else {
    vi.mocked(authMod.getSession).mockResolvedValue({
      user: {
        id: userId,
        name: '',
        email: '',
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
        image: null,
        role,
        locale: 'zh',
        status: 'ACTIVE',
      } as never,
      session: {
        id: '',
        userId,
        token: '',
        expiresAt: new Date(Date.now() + 86_400_000),
        ipAddress: null,
        userAgent: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as never,
    })
  }
}

function makeRequest(verificationId: string, index: string | number): Request {
  return new Request(
    `http://localhost/api/admin/verification-docs/${verificationId}/${index}`,
    { method: 'GET' },
  )
}

function makeS3Stream(): Readable {
  const r = new Readable({ read() {} })
  r.push('PDF-content')
  r.push(null)
  return r
}

beforeEach(() => {
  vi.clearAllMocks()
  mockS3Send.mockResolvedValue({
    Body: makeS3Stream(),
    ContentType: 'application/pdf',
    ContentLength: 11,
  })
})

async function createAdminUser() {
  return testDb.user.create({
    data: {
      name: 'Admin User',
      email: `admin-vdoc-${Date.now()}@example.test`,
      emailVerified: true,
      role: 'ADMIN',
      status: 'ACTIVE',
    },
  })
}

async function createVerification(documentKeys: string[] = ['verifications/cv1/doc.pdf']) {
  const owner = await testDb.user.create({
    data: {
      name: 'Owner',
      email: `owner-vdoc-${Date.now()}@example.test`,
      emailVerified: true,
      role: 'EMPLOYER',
      status: 'ACTIVE',
    },
  })
  const company = await testDb.company.create({
    data: { legalName: 'VerDoc Test Co', verificationStatus: 'PENDING', isActive: true },
  })
  await testDb.companyMember.create({
    data: { companyId: company.id, userId: owner.id, role: 'OWNER' },
  })
  const cv = await testDb.companyVerification.create({
    data: {
      companyId: company.id,
      documentKeys,
      status: 'PENDING',
      submittedById: owner.id,
    },
  })
  return { cv, company, owner }
}

describe('GET /api/admin/verification-docs/[verificationId]/[index]', () => {
  it('unauthenticated → 403 (project convention: route() returns 403 for unauthenticated)', async () => {
    mockSession(null)
    const { cv } = await createVerification()
    const res = await GET(makeRequest(cv.id, 0))
    expect(res.status).toBe(403)
  })

  it('STUDENT → 403', async () => {
    const student = await testDb.user.create({
      data: { name: 'S', email: `stu-vdoc-${Date.now()}@example.test`, emailVerified: true, role: 'STUDENT', status: 'ACTIVE' },
    })
    mockSession(student.id, 'STUDENT')
    const { cv } = await createVerification()
    const res = await GET(makeRequest(cv.id, 0))
    expect(res.status).toBe(403)
  })

  it('EMPLOYER → 403', async () => {
    const emp = await testDb.user.create({
      data: { name: 'E', email: `emp-vdoc-${Date.now()}@example.test`, emailVerified: true, role: 'EMPLOYER', status: 'ACTIVE' },
    })
    mockSession(emp.id, 'EMPLOYER')
    const { cv } = await createVerification()
    const res = await GET(makeRequest(cv.id, 0))
    expect(res.status).toBe(403)
  })

  it('non-existent verificationId → 404', async () => {
    const admin = await createAdminUser()
    mockSession(admin.id)
    const fakeId = 'cm000000000000000000000000'
    const res = await GET(makeRequest(fakeId, 0))
    expect(res.status).toBe(404)
  })

  it('non-cuid verificationId → 404', async () => {
    const admin = await createAdminUser()
    mockSession(admin.id)
    const res = await GET(makeRequest('not-a-cuid!', 0))
    expect(res.status).toBe(404)
  })

  it('index out of bounds → 404', async () => {
    const admin = await createAdminUser()
    mockSession(admin.id)
    const { cv } = await createVerification(['verifications/cv1/doc.pdf'])
    const res = await GET(makeRequest(cv.id, 5))
    expect(res.status).toBe(404)
  })

  it('ContentLength > 10 MB → 502', async () => {
    const admin = await createAdminUser()
    mockSession(admin.id)
    const { cv } = await createVerification()
    mockS3Send.mockResolvedValueOnce({
      Body: makeS3Stream(),
      ContentType: 'application/pdf',
      ContentLength: 10 * 1024 * 1024 + 1, // 1 byte over the 10 MB limit
    })
    const res = await GET(makeRequest(cv.id, 0))
    expect(res.status).toBe(502)
  })

  it('S3 error → 502, body has no raw error', async () => {
    const admin = await createAdminUser()
    mockSession(admin.id)
    const { cv } = await createVerification()
    mockS3Send.mockRejectedValueOnce(new Error('NoSuchKey: s3://bucket/key — secret details'))
    const res = await GET(makeRequest(cv.id, 0))
    expect(res.status).toBe(502)
    const body = await res.text()
    expect(body).not.toContain('NoSuchKey')
    expect(body).not.toContain('secret details')
  })

  it('no ContentLength, oversized body → stream aborts before all bytes reach client', async () => {
    const admin = await createAdminUser()
    mockSession(admin.id)
    const { cv } = await createVerification()

    const LIMIT = 10 * 1024 * 1024
    const extra = 100 * 1024
    const totalBytes = LIMIT + extra
    const chunkSize = 64 * 1024
    let pushed = 0
    const oversizedStream = new Readable({
      read() {
        if (pushed >= totalBytes) { this.push(null); return }
        const size = Math.min(chunkSize, totalBytes - pushed)
        this.push(Buffer.alloc(size, 0x41))
        pushed += size
      },
    })
    mockS3Send.mockResolvedValueOnce({
      Body: oversizedStream,
      ContentType: 'application/pdf',
      // No ContentLength — simulates chunked/streaming S3 response
    })

    const res = await GET(makeRequest(cv.id, 0))
    // Headers are committed before streaming; status is always 200 at this point
    expect(res.status).toBe(200)

    let totalRead = 0
    let threw = false
    try {
      const reader = res.body!.getReader()
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        totalRead += value?.byteLength ?? 0
      }
    } catch {
      threw = true
    }

    // With the size guard: stream must error or stop at LIMIT bytes, not deliver full LIMIT+100KB
    // threw=true means the stream was aborted cleanly; otherwise, bytes read must not exceed LIMIT
    expect(threw || totalRead <= LIMIT).toBe(true)
    // Critical: we did NOT forward the entire oversized payload regardless of how the stream ended
    expect(totalRead).toBeLessThan(totalBytes)
  })

  it('ADMIN success: returns 200, correct headers, writes audit log without filename', async () => {
    const admin = await createAdminUser()
    mockSession(admin.id)
    const { cv } = await createVerification(['verifications/company1/ssm-cert.pdf'])
    const res = await GET(makeRequest(cv.id, 0))
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Disposition')).toContain("attachment; filename*=UTF-8''")
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff')
    expect(res.headers.get('Content-Security-Policy')).toContain('sandbox')
    expect(res.headers.get('Cache-Control')).toBe('private, no-store')
    expect(res.headers.get('X-Robots-Tag')).toBe('noindex')

    // Audit log written, no filename or S3 key in metadata
    const audit = await testDb.auditLog.findFirst({
      where: { action: 'company.verification.doc_view', actorId: admin.id },
      orderBy: { createdAt: 'desc' },
    })
    expect(audit).toBeTruthy()
    const meta = audit!.metadata as Record<string, unknown>
    expect(meta.verificationId).toBe(cv.id)
    expect(meta.index).toBe(0)
    expect(meta).not.toHaveProperty('fileName')
    expect(meta).not.toHaveProperty('key')
  })
})
