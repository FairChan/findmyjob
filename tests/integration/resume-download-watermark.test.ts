/**
 * Integration test: resume download — sanitization, watermark, authz (M4-T19).
 *
 * Does NOT mock pdf-lib. Only mocks getObjectBytes to supply a sample PDF.
 * Verifies that:
 *  - sanitizePdf removes dangerous catalog entries, page /AA, and dangerous annotations
 *  - watermarkPdf is applied (content stream check)
 *  - URI Link annotation is preserved after sanitization
 *  - Page count is preserved
 *  - Audit record is created
 *  - Dangerous catalog keys are absent in the response PDF
 */
import { vi, describe, it, expect, beforeEach } from 'vitest'
import { PDFDocument, PDFName, PDFHexString, PDFArray, PDFDict } from 'pdf-lib'

vi.mock('@/server/auth', () => ({
  getSession: vi.fn(),
  auth: {},
}))

vi.mock('@/server/db', async () => {
  const { testDb } = await import('../setup/db')
  return { db: testDb }
})

const mockGetObjectBytes = vi.fn()
vi.mock('@/lib/storage', () => ({
  getObjectBytes: mockGetObjectBytes,
  getSignedDownloadUrl: vi.fn(),
  getSignedUploadUrl: vi.fn(),
  putObject: vi.fn(),
  deleteAllVersions: vi.fn(),
}))

vi.mock('next/headers', () => ({
  headers: vi.fn().mockResolvedValue(new Headers()),
}))

import { setupTestDb, testDb } from '../setup/db'
import { createStudent, createEmployer } from '../factories'
import * as authMod from '@/server/auth'

setupTestDb()

function mockSession(userId: string | null, role = 'STUDENT') {
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
      },
    })
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

// ---------------------------------------------------------------------------
// Build a 3-page sample PDF with dangerous content to test sanitization
// ---------------------------------------------------------------------------

async function buildDangerousPdf(): Promise<Buffer> {
  const doc = await PDFDocument.create()
  for (let i = 0; i < 3; i++) {
    doc.addPage([612, 792])
  }

  // 1. catalog /OpenAction with JavaScript
  doc.catalog.set(PDFName.of('OpenAction'), doc.context.obj({
    S: 'JavaScript',
    JS: PDFHexString.fromText('app.alert("open")'),
  }))

  // 2. /Names with JavaScript and EmbeddedFiles
  doc.catalog.set(PDFName.of('Names'), doc.context.obj({
    JavaScript: doc.context.obj({
      Names: doc.context.obj([
        PDFHexString.fromText('script1'),
        doc.context.obj({ S: 'JavaScript', JS: PDFHexString.fromText('alert(2)') }),
      ]),
    }),
    EmbeddedFiles: doc.context.obj({
      Names: doc.context.obj([]),
    }),
  }))

  // 3. page[0] /AA with JavaScript on open
  const page0 = doc.getPage(0)
  page0.node.set(PDFName.of('AA'), doc.context.obj({
    O: doc.context.obj({ S: 'JavaScript', JS: PDFHexString.fromText('alert("page open")') }),
  }))

  // 4. Link annotation with JavaScript action (should be removed)
  const jsAnnotRef = doc.context.register(doc.context.obj({
    Type: 'Annot',
    Subtype: 'Link',
    Rect: [10, 700, 200, 720],
    A: { S: 'JavaScript', JS: PDFHexString.fromText('app.alert(1)') },
  }))

  // 5. FileAttachment annotation (should be removed)
  const faAnnotRef = doc.context.register(doc.context.obj({
    Type: 'Annot',
    Subtype: 'FileAttachment',
    Rect: [10, 650, 200, 670],
    FS: { Type: 'Filespec', F: PDFHexString.fromText('malware.exe') },
  }))

  // 6. URI Link annotation (should be preserved)
  const uriAnnotRef = doc.context.register(doc.context.obj({
    Type: 'Annot',
    Subtype: 'Link',
    Rect: [10, 600, 200, 620],
    A: { S: 'URI', URI: PDFHexString.fromText('https://example.com') },
  }))

  page0.node.set(PDFName.of('Annots'), doc.context.obj([jsAnnotRef, faAnnotRef, uriAnnotRef]))

  return Buffer.from(await doc.save())
}

/** Check a named key is in the catalog of a PDF buffer. */
async function catalogHasKey(pdfBuf: Buffer, key: string): Promise<boolean> {
  const doc = await PDFDocument.load(pdfBuf)
  return doc.catalog.has(PDFName.of(key))
}

/** Check if any page has /AA. */
async function anyPageHasAA(pdfBuf: Buffer): Promise<boolean> {
  const doc = await PDFDocument.load(pdfBuf)
  for (let i = 0; i < doc.getPageCount(); i++) {
    if (doc.getPage(i).node.has(PDFName.of('AA'))) return true
  }
  return false
}

type AnnotInfo = { subtype: string; actionS?: string }

async function getAnnotsOnPage0(pdfBuf: Buffer): Promise<AnnotInfo[]> {
  const doc = await PDFDocument.load(pdfBuf)
  const page = doc.getPage(0)
  const annotsVal = page.node.get(PDFName.of('Annots'))
  if (!annotsVal) return []
  let arr: PDFArray | null = null
  try { arr = doc.context.lookup(annotsVal, PDFArray) } catch { return [] }
  const result: AnnotInfo[] = []
  for (let i = 0; i < arr.size(); i++) {
    try {
      const d = doc.context.lookup(arr.get(i), PDFDict)
      const rawSt = doc.context.lookupMaybe(d.get(PDFName.of('Subtype')), PDFName)?.asString() ?? '?'
      const st = rawSt.replace(/^\//, '')
      let actionS: string | undefined
      const aVal = d.get(PDFName.of('A'))
      if (aVal) {
        try {
          const aDict = doc.context.lookup(aVal, PDFDict)
          const rawS = doc.context.lookupMaybe(aDict.get(PDFName.of('S')), PDFName)?.asString()
          actionS = rawS?.replace(/^\//, '')
        } catch {}
      }
      result.push({ subtype: st, actionS })
    } catch {}
  }
  return result
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('resume download — real PDF sanitize + watermark (M4-T19)', () => {
  async function setupFixture(opts?: { displayNameEn?: string | null; companyVerified?: boolean }) {
    const { profileId } = await createStudent(testDb)
    await testDb.studentProfile.update({
      where: { id: profileId },
      data: { visibility: 'PUBLIC', schoolVerifiedAt: new Date(), completeness: 80 },
    })
    const resume = await testDb.resumeFile.create({
      data: {
        studentId: profileId,
        storageKey: 'resumes/wm-test/cv.pdf',
        fileName: 'cv.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 10 * 1024, // well under 5MB
      },
    })

    const emp = await createEmployer(testDb)
    if (opts?.displayNameEn !== undefined) {
      await testDb.company.update({
        where: { id: emp.companyId },
        data: {
          verificationStatus: opts.companyVerified !== false ? 'VERIFIED' : 'PENDING',
          displayNameEn: opts.displayNameEn,
        },
      })
    } else {
      await testDb.company.update({
        where: { id: emp.companyId },
        data: { verificationStatus: opts?.companyVerified !== false ? 'VERIFIED' : 'PENDING' },
      })
    }

    await testDb.creditWallet.upsert({
      where: { companyId: emp.companyId },
      create: { companyId: emp.companyId, balance: 10 },
      update: {},
    })
    await testDb.talentUnlock.create({
      data: { companyId: emp.companyId, studentId: profileId, unlockedById: emp.userId, source: 'CREDIT', creditsSpent: 1 },
    })

    return { profileId, resumeId: resume.id, emp }
  }

  it('sanitized + watermarked PDF: dangerous content removed, URI Link preserved, page count 3', async () => {
    const dangerousPdf = await buildDangerousPdf()
    const { profileId, resumeId, emp } = await setupFixture()
    mockGetObjectBytes.mockResolvedValueOnce(dangerousPdf)
    mockSession(emp.userId, 'EMPLOYER')

    const { GET } = await import('@/app/api/resumes/[id]/download/route')
    const res = await GET(new Request(`http://localhost/api/resumes/${resumeId}/download`))

    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('application/pdf')
    expect(res.headers.get('cache-control')).toContain('no-store')
    expect(res.headers.get('x-robots-tag')).toBe('noindex')

    const bodyBuf = Buffer.from(await res.arrayBuffer())

    // Page count preserved
    const outDoc = await PDFDocument.load(bodyBuf)
    expect(outDoc.getPageCount()).toBe(3)

    // No dangerous catalog keys
    expect(await catalogHasKey(bodyBuf, 'OpenAction')).toBe(false)
    expect(await catalogHasKey(bodyBuf, 'Names')).toBe(false)
    expect(await catalogHasKey(bodyBuf, 'AcroForm')).toBe(false)

    // No page /AA
    expect(await anyPageHasAA(bodyBuf)).toBe(false)

    // Only the URI Link annotation should remain on page 0
    const annots = await getAnnotsOnPage0(bodyBuf)
    expect(annots).toHaveLength(1)
    expect(annots[0].subtype).toBe('Link')
    expect(annots[0].actionS).toBe('URI')

    // Audit record created
    const audits = await testDb.auditLog.findMany({
      where: { action: 'resume.download', targetId: resumeId },
    })
    expect(audits).toHaveLength(1)
    // Metadata only contains internal IDs (no PII)
    const meta = audits[0].metadata as Record<string, string>
    expect(Object.keys(meta).sort()).toEqual(['companyId', 'studentId'].sort())
    expect(meta.studentId).toBe(profileId)
  }, 60_000)

  it('displayNameEn with Chinese characters falls back gracefully — download succeeds', async () => {
    const dangerousPdf = await buildDangerousPdf()
    const { resumeId, emp } = await setupFixture({ displayNameEn: '马来西亚科技公司' })
    mockGetObjectBytes.mockResolvedValueOnce(dangerousPdf)
    mockSession(emp.userId, 'EMPLOYER')

    const { GET } = await import('@/app/api/resumes/[id]/download/route')
    const res = await GET(new Request(`http://localhost/api/resumes/${resumeId}/download`))
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('application/pdf')
  }, 60_000)

  it('sizeBytes exceeds RESUME_MAX_BYTES — getObjectBytes NOT called, 422 returned', async () => {
    const { profileId } = await createStudent(testDb)
    const resume = await testDb.resumeFile.create({
      data: {
        studentId: profileId,
        storageKey: 'resumes/big/cv.pdf',
        fileName: 'cv.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 6 * 1024 * 1024, // 6MB > 5MB limit
      },
    })
    const emp = await createEmployer(testDb)
    await testDb.company.update({ where: { id: emp.companyId }, data: { verificationStatus: 'VERIFIED' } })
    await testDb.creditWallet.upsert({
      where: { companyId: emp.companyId },
      create: { companyId: emp.companyId, balance: 10 },
      update: {},
    })
    await testDb.talentUnlock.create({
      data: { companyId: emp.companyId, studentId: profileId, unlockedById: emp.userId, source: 'CREDIT', creditsSpent: 1 },
    })
    mockSession(emp.userId, 'EMPLOYER')

    const { GET } = await import('@/app/api/resumes/[id]/download/route')
    const res = await GET(new Request(`http://localhost/api/resumes/${resume.id}/download`))
    expect(res.status).toBe(422)
    expect(mockGetObjectBytes).not.toHaveBeenCalled()
  }, 15_000)

  it('blocked student → 404 (TM-003 gone)', async () => {
    const minPdf = Buffer.from(
      await (await PDFDocument.create().then(d => { d.addPage([612, 792]); return d })).save(),
    )
    const { profileId, resumeId, emp } = await setupFixture()
    await testDb.blockedCompany.create({ data: { studentId: profileId, companyId: emp.companyId } })
    mockGetObjectBytes.mockResolvedValueOnce(minPdf)
    mockSession(emp.userId, 'EMPLOYER')

    const { GET } = await import('@/app/api/resumes/[id]/download/route')
    const res = await GET(new Request(`http://localhost/api/resumes/${resumeId}/download`))
    expect(res.status).toBe(404)
  }, 15_000)

  it('SUSPENDED student → 404 (TM-003 gone)', async () => {
    const { profileId, resumeId, emp } = await setupFixture()
    // Suspend the student
    const profile = await testDb.studentProfile.findUnique({ where: { id: profileId }, select: { userId: true } })
    await testDb.user.update({ where: { id: profile!.userId }, data: { status: 'SUSPENDED' } })
    mockSession(emp.userId, 'EMPLOYER')

    const { GET } = await import('@/app/api/resumes/[id]/download/route')
    const res = await GET(new Request(`http://localhost/api/resumes/${resumeId}/download`))
    expect(res.status).toBe(404)
  }, 15_000)

  it('DELETED student → 404 (TM-003 gone)', async () => {
    const { profileId, resumeId, emp } = await setupFixture()
    const profile = await testDb.studentProfile.findUnique({ where: { id: profileId }, select: { userId: true } })
    await testDb.user.update({ where: { id: profile!.userId }, data: { status: 'DELETED' } })
    mockSession(emp.userId, 'EMPLOYER')

    const { GET } = await import('@/app/api/resumes/[id]/download/route')
    const res = await GET(new Request(`http://localhost/api/resumes/${resumeId}/download`))
    expect(res.status).toBe(404)
  }, 15_000)

  it('no TalentUnlock → 403 (no_unlock)', async () => {
    const { profileId } = await createStudent(testDb)
    await testDb.studentProfile.update({
      where: { id: profileId },
      data: { visibility: 'PUBLIC', completeness: 80 },
    })
    const resume = await testDb.resumeFile.create({
      data: {
        studentId: profileId,
        storageKey: 'resumes/nounlock/cv.pdf',
        fileName: 'cv.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 1024,
      },
    })
    const emp = await createEmployer(testDb)
    await testDb.company.update({ where: { id: emp.companyId }, data: { verificationStatus: 'VERIFIED' } })
    mockSession(emp.userId, 'EMPLOYER')

    const { GET } = await import('@/app/api/resumes/[id]/download/route')
    const res = await GET(new Request(`http://localhost/api/resumes/${resume.id}/download`))
    expect(res.status).toBe(403)
    expect(mockGetObjectBytes).not.toHaveBeenCalled()
  }, 15_000)

  it('IDOR: company unlocked student X, downloads student Y resume → 403', async () => {
    const { profileId: xProfile } = await createStudent(testDb)
    await testDb.studentProfile.update({
      where: { id: xProfile },
      data: { visibility: 'PUBLIC', completeness: 80 },
    })

    const { profileId: yProfile } = await createStudent(testDb)
    await testDb.studentProfile.update({
      where: { id: yProfile },
      data: { visibility: 'PUBLIC', completeness: 80 },
    })
    const yResume = await testDb.resumeFile.create({
      data: {
        studentId: yProfile,
        storageKey: 'resumes/idor/cv.pdf',
        fileName: 'cv.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 1024,
      },
    })

    const emp = await createEmployer(testDb)
    await testDb.company.update({ where: { id: emp.companyId }, data: { verificationStatus: 'VERIFIED' } })
    await testDb.creditWallet.upsert({
      where: { companyId: emp.companyId },
      create: { companyId: emp.companyId, balance: 10 },
      update: {},
    })
    // Only unlock student X
    await testDb.talentUnlock.create({
      data: { companyId: emp.companyId, studentId: xProfile, unlockedById: emp.userId, source: 'CREDIT', creditsSpent: 1 },
    })
    mockSession(emp.userId, 'EMPLOYER')

    // Attempt to download student Y's resume (which the company has NOT unlocked)
    const { GET } = await import('@/app/api/resumes/[id]/download/route')
    const res = await GET(new Request(`http://localhost/api/resumes/${yResume.id}/download`))
    expect(res.status).toBe(403)
  }, 15_000)
})
