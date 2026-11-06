/**
 * Integration tests: GET /api/resumes/[id] ownership guard (M2-T05).
 * Critical privacy path: a student must only be able to download their own resume.
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

const mockGetSignedDownloadUrl = vi.fn()
vi.mock('@/lib/storage', () => ({
  getSignedDownloadUrl: mockGetSignedDownloadUrl,
  deleteAllVersions: vi.fn().mockResolvedValue(undefined),
  getSignedUploadUrl: vi.fn(),
  putObject: vi.fn(),
}))

vi.mock('next/headers', () => ({
  headers: vi.fn().mockResolvedValue(new Headers()),
}))

import { setupTestDb, testDb } from '../setup/db'
import { createStudent, createEmployer } from '../factories'
import * as authMod from '@/server/auth'

setupTestDb()

const { GET } = await import('@/app/api/resumes/[id]/route')

function mockSession(userId: string | null) {
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
        role: 'STUDENT',
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
      },
    })
  }
}

function makeRequest(id: string): Request {
  return new Request(`http://localhost/api/resumes/${id}`)
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('GET /api/resumes/[id] ownership guard (M2-T05)', () => {
  it('student B downloading student A resume → 404, getSignedDownloadUrl not called', async () => {
    const a = await createStudent(testDb)
    const b = await createStudent(testDb)
    const resume = await testDb.resumeFile.create({
      data: {
        studentId: a.profileId,
        storageKey: 'resumes/a/cv.pdf',
        fileName: 'cv.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 1024,
      },
    })
    mockSession(b.userId)
    const res = await GET(makeRequest(resume.id))
    expect(res.status).toBe(404)
    expect(mockGetSignedDownloadUrl).not.toHaveBeenCalled()
  })

  it('student A downloading their own resume → 302, getSignedDownloadUrl called with correct storageKey', async () => {
    const a = await createStudent(testDb)
    const storageKey = 'resumes/a/my-cv.pdf'
    const resume = await testDb.resumeFile.create({
      data: {
        studentId: a.profileId,
        storageKey,
        fileName: 'my-cv.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 2048,
      },
    })
    mockGetSignedDownloadUrl.mockResolvedValue('https://minio.example.test/signed')
    mockSession(a.userId)
    const res = await GET(makeRequest(resume.id))
    expect(res.status).toBe(302)
    expect(mockGetSignedDownloadUrl).toHaveBeenCalledOnce()
    expect(mockGetSignedDownloadUrl).toHaveBeenCalledWith(storageKey, 'my-cv.pdf')
  })

  it('invalid id (not-a-cuid) → 404, getSignedDownloadUrl not called', async () => {
    const a = await createStudent(testDb)
    mockSession(a.userId)
    const res = await GET(makeRequest('not-a-cuid'))
    expect(res.status).toBe(404)
    expect(mockGetSignedDownloadUrl).not.toHaveBeenCalled()
  })

  it('employer account → 403, getSignedDownloadUrl not called', async () => {
    const { userId } = await createEmployer(testDb)
    mockSession(userId)
    const res = await GET(makeRequest('cjld2cyuq0000t3rmniod1foy'))
    expect(res.status).toBe(403)
    expect(mockGetSignedDownloadUrl).not.toHaveBeenCalled()
  })

  it('unauthenticated → 403, getSignedDownloadUrl not called', async () => {
    mockSession(null)
    const res = await GET(makeRequest('cjld2cyuq0000t3rmniod1foy'))
    expect(res.status).toBe(403)
    expect(mockGetSignedDownloadUrl).not.toHaveBeenCalled()
  })
})
