/**
 * M3-T07 "撤掉净化之后测试会失败" proof.
 *
 * Uses a real PDF containing /OpenAction, real sanitizePdf (no mock), real test DB,
 * and mocked S3 + auth.  After the route runs, the response bytes must NOT contain
 * /OpenAction.
 *
 * Red-run: comment out the sanitizePdf call in the route and return rawBuf directly.
 * afterDoc.catalog.has(PDFName.of('OpenAction')) would be true → test fails.
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

const mockS3Send = vi.fn()
vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: vi.fn().mockImplementation(function () {
    return { send: mockS3Send }
  }),
  GetObjectCommand: vi.fn().mockImplementation(function (input: unknown) {
    return input
  }),
}))

import { PDFDocument, PDFName, PDFHexString } from 'pdf-lib'
import { Readable } from 'node:stream'
import { setupTestDb, testDb } from '../setup/db'
import * as authMod from '@/server/auth'
import { GET } from '@/app/api/admin/verification-docs/[verificationId]/[index]/route'

setupTestDb()

function mockSession(userId: string | null, role = 'ADMIN') {
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

function makeS3StreamFrom(buf: Buffer): Readable {
  const r = new Readable({ read() {} })
  r.push(buf)
  r.push(null)
  return r
}

function makeRequest(verificationId: string, index: number): Request {
  return new Request(
    `http://localhost/api/admin/verification-docs/${verificationId}/${index}`,
    { method: 'GET' },
  )
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('M3-T07 real-PDF sanitisation (撤掉净化之后测试会失败)', () => {
  it('response PDF has /OpenAction removed — removing sanitizePdf from route makes this fail', async () => {
    // Build a PDF with /OpenAction JavaScript in catalog.
    const srcDoc = await PDFDocument.create()
    srcDoc.addPage([612, 792])
    srcDoc.catalog.set(PDFName.of('OpenAction'), srcDoc.context.obj({
      S: 'JavaScript',
      JS: PDFHexString.fromText('app.alert("open")'),
    }))
    const pdfBuf = Buffer.from(await srcDoc.save())

    // Confirm the sample has /OpenAction before sanitisation.
    const beforeDoc = await PDFDocument.load(pdfBuf)
    expect(beforeDoc.catalog.has(PDFName.of('OpenAction'))).toBe(true)

    // Set up DB fixture
    const admin = await testDb.user.create({
      data: {
        name: 'Admin Sanitize',
        email: `admin-san-${Date.now()}@example.test`,
        emailVerified: true,
        role: 'ADMIN',
        status: 'ACTIVE',
      },
    })
    const owner = await testDb.user.create({
      data: {
        name: 'Owner San',
        email: `owner-san-${Date.now()}@example.test`,
        emailVerified: true,
        role: 'EMPLOYER',
        status: 'ACTIVE',
      },
    })
    const company = await testDb.company.create({
      data: { legalName: 'SanitizeTest Co', verificationStatus: 'PENDING', isActive: true },
    })
    await testDb.companyMember.create({
      data: { companyId: company.id, userId: owner.id, role: 'OWNER' },
    })
    const cv = await testDb.companyVerification.create({
      data: {
        companyId: company.id,
        documentKeys: [`verifications/${company.id}/ssm.pdf`],
        status: 'PENDING',
        submittedById: owner.id,
      },
    })

    mockSession(admin.id)
    mockS3Send.mockResolvedValueOnce({
      Body: makeS3StreamFrom(pdfBuf),
      ContentType: 'application/pdf',
      ContentLength: pdfBuf.byteLength,
    })

    const res = await GET(makeRequest(cv.id, 0))
    expect(res.status).toBe(200)

    const responseBytes = Buffer.from(await res.arrayBuffer())
    const afterDoc = await PDFDocument.load(responseBytes)

    // /OpenAction must have been stripped by sanitizePdf.
    // Red-run: return rawBuf instead of sanitized.pdf in route → afterDoc has /OpenAction → fails.
    expect(afterDoc.catalog.has(PDFName.of('OpenAction'))).toBe(false)
  }, 60_000)
})
