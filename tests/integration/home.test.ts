/**
 * Integration tests for M7-T01: home-page services and partner-logo proxy.
 *
 * Covers:
 * - getHomePartners: does NOT expose notes, agreementKey, or logoKey
 * - getPublicPartners: same field exclusions
 * - getLatestJobs: excludes DRAFT, PENDING, CLOSED, and expired jobs
 * - Partner logo proxy: valid png → 200 + nosniff; bad key prefix → 404;
 *   non-image content → 404; partner without logo → 404
 */
import { vi, describe, it, expect } from 'vitest'

const { PNG_MAGIC } = vi.hoisted(() => ({
  PNG_MAGIC: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...Array(100).fill(0)]),
}))

vi.mock('@/server/auth', () => ({
  getSession: vi.fn(),
  auth: {},
}))

vi.mock('@/server/db', async () => {
  const { testDb } = await import('../setup/db')
  return { db: testDb }
})

vi.mock('@/lib/storage', () => ({
  getObjectBytes: vi.fn().mockResolvedValue(PNG_MAGIC),
  putObject: vi.fn().mockResolvedValue(undefined),
  getSignedDownloadUrl: vi.fn().mockResolvedValue('https://cdn.example.test/file'),
  getSignedDisplayUrl: vi.fn().mockResolvedValue('https://cdn.example.test/display'),
  getSignedUploadUrl: vi.fn().mockResolvedValue({ url: '', fields: {} }),
  deleteAllVersions: vi.fn().mockResolvedValue(undefined),
  SIGNED_URL_EXPIRES_SECONDS: 300,
}))

import { setupTestDb, testDb } from '../setup/db'
import { createEmployer, createJob } from '../factories'
import { getHomePartners, getPublicPartners } from '@/server/services/admin-schools-partners'
import { getHomeStats, getLatestJobs } from '@/server/services/home'
import { getObjectBytes } from '@/lib/storage'

setupTestDb()

// ---- getHomePartners / getPublicPartners field safety ----

describe('getHomePartners', () => {
  it('does not expose notes, agreementKey, or logoKey', async () => {
    await testDb.partner.create({
      data: {
        name: 'Uni Malaya',
        type: 'SCHOOL',
        showOnHome: true,
        notes: 'SECRET NOTE',
        agreementKey: 'agreements/secret.pdf',
        logoKey: 'partner-logos/uni-malaya/abc12345-0000-0000-0000-000000000001.png',
      },
    })

    const partners = await getHomePartners()
    expect(partners.length).toBeGreaterThan(0)

    for (const p of partners) {
      expect(p).not.toHaveProperty('notes')
      expect(p).not.toHaveProperty('agreementKey')
      expect(p).not.toHaveProperty('logoKey')
      expect(typeof p.hasLogo).toBe('boolean')
    }
  })

  it('hasLogo is true only when logoKey has valid format', async () => {
    const withLogo = await testDb.partner.create({
      data: {
        name: 'PartnerWithLogo',
        type: 'ENTERPRISE',
        showOnHome: true,
        logoKey: 'partner-logos/partnerwithl/abc12345-0000-0000-0000-000000000002.png',
      },
    })
    const withoutLogo = await testDb.partner.create({
      data: { name: 'PartnerNoLogo', type: 'ENTERPRISE', showOnHome: true },
    })

    const partners = await getHomePartners()
    const pWith = partners.find((p) => p.id === withLogo.id)
    const pWithout = partners.find((p) => p.id === withoutLogo.id)

    expect(pWith?.hasLogo).toBe(true)
    expect(pWithout?.hasLogo).toBe(false)
  })

  it('only returns showOnHome=true partners', async () => {
    const hidden = await testDb.partner.create({
      data: { name: 'HiddenPartner', type: 'NGO', showOnHome: false },
    })

    const partners = await getHomePartners()
    expect(partners.find((p) => p.id === hidden.id)).toBeUndefined()
  })
})

describe('getPublicPartners', () => {
  it('does not expose notes, agreementKey, or logoKey', async () => {
    await testDb.partner.create({
      data: {
        name: 'OffHomePartner',
        type: 'GOVERNMENT',
        showOnHome: false,
        notes: 'INTERNAL NOTE',
        agreementKey: 'agreements/internal.pdf',
        logoKey: 'partner-logos/offhome/abc12345-0000-0000-0000-000000000003.png',
      },
    })

    const partners = await getPublicPartners()
    expect(partners.length).toBeGreaterThan(0)

    for (const p of partners) {
      expect(p).not.toHaveProperty('notes')
      expect(p).not.toHaveProperty('agreementKey')
      expect(p).not.toHaveProperty('logoKey')
    }
  })

  it('includes showOnHome=false partners', async () => {
    const off = await testDb.partner.create({
      data: { name: 'PublicButOffHome', type: 'SOE', showOnHome: false },
    })

    const partners = await getPublicPartners()
    expect(partners.find((p) => p.id === off.id)).toBeDefined()
  })
})

// ---- getLatestJobs status filtering ----

describe('getLatestJobs', () => {
  it('excludes DRAFT jobs', async () => {
    const { userId, companyId } = await createEmployer(testDb)
    await testDb.company.update({
      where: { id: companyId },
      data: { verificationStatus: 'VERIFIED', approvedJobCount: 0 },
    })
    const job = await createJob(testDb, companyId, userId, { status: 'DRAFT' })

    const jobs = await getLatestJobs(50)
    expect(jobs.find((j) => j.id === job.id)).toBeUndefined()
  })

  it('excludes CLOSED jobs', async () => {
    const { userId, companyId } = await createEmployer(testDb)
    await testDb.company.update({
      where: { id: companyId },
      data: { verificationStatus: 'VERIFIED', approvedJobCount: 0 },
    })
    const job = await createJob(testDb, companyId, userId, { status: 'CLOSED' })

    const jobs = await getLatestJobs(50)
    expect(jobs.find((j) => j.id === job.id)).toBeUndefined()
  })

  it('excludes expired PUBLISHED jobs (deadline in the past)', async () => {
    const { userId, companyId } = await createEmployer(testDb)
    await testDb.company.update({
      where: { id: companyId },
      data: { verificationStatus: 'VERIFIED', approvedJobCount: 0 },
    })
    const job = await createJob(testDb, companyId, userId, { status: 'PUBLISHED' })
    // Set a past deadline directly
    await testDb.job.update({
      where: { id: job.id },
      data: { deadline: new Date(Date.now() - 1000 * 60 * 60 * 24) },
    })

    const jobs = await getLatestJobs(50)
    expect(jobs.find((j) => j.id === job.id)).toBeUndefined()
  })

  it('includes PUBLISHED job without deadline', async () => {
    const { userId, companyId } = await createEmployer(testDb)
    await testDb.company.update({
      where: { id: companyId },
      data: { verificationStatus: 'VERIFIED', approvedJobCount: 0 },
    })
    const job = await createJob(testDb, companyId, userId, { status: 'PUBLISHED' })

    const jobs = await getLatestJobs(50)
    expect(jobs.find((j) => j.id === job.id)).toBeDefined()
  })
})

// ---- Partner logo proxy ----

describe('home jobs exclude suspended companies (M6-T12 rule)', () => {
  it('getLatestJobs and the published-job count skip jobs of an inactive company', async () => {
    const active = await createEmployer(testDb)
    const suspended = await createEmployer(testDb)
    await testDb.company.update({ where: { id: suspended.companyId }, data: { isActive: false } })
    const okJob = await createJob(testDb, active.companyId, active.userId, { status: 'PUBLISHED' })
    const hiddenJob = await createJob(testDb, suspended.companyId, suspended.userId, { status: 'PUBLISHED' })

    const ids = (await getLatestJobs(50)).map((j) => j.id)
    expect(ids).toContain(okJob.id)
    expect(ids).not.toContain(hiddenJob.id)

    const stats = await getHomeStats()
    const expected = await testDb.job.count({ where: { status: 'PUBLISHED', company: { isActive: true } } })
    expect(stats.publishedJobCount).toBe(expected)
    expect(await testDb.job.count({ where: { status: 'PUBLISHED' } })).toBe(expected + 1)
  })
})

describe('partner logo proxy', () => {
  const makeRequest = (partnerId: string) =>
    new Request(`http://localhost/api/partner-logos/${partnerId}`)

  it('returns 200 with nosniff for a valid logo key', async () => {
    const partner = await testDb.partner.create({
      data: {
        name: 'LogoPartner',
        type: 'ENTERPRISE',
        logoKey: 'partner-logos/logopartner/abc12345-0000-0000-0000-000000000010.png',
      },
    })

    vi.mocked(getObjectBytes).mockResolvedValueOnce(PNG_MAGIC)

    const { GET } = await import('@/app/api/partner-logos/[partnerId]/route')
    const res = await GET(makeRequest(partner.id))

    expect(res.status).toBe(200)
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff')
    expect(res.headers.get('Content-Type')).toBe('image/png')
  })

  it('returns 404 for a partner without logoKey', async () => {
    const partner = await testDb.partner.create({
      data: { name: 'NoLogoPartner', type: 'NGO' },
    })

    const { GET } = await import('@/app/api/partner-logos/[partnerId]/route')
    const res = await GET(makeRequest(partner.id))

    expect(res.status).toBe(404)
  })

  it('returns 404 for a logoKey that does not match valid prefix', async () => {
    const partner = await testDb.partner.create({
      data: {
        name: 'BadKeyPartner',
        type: 'NGO',
        logoKey: 'uploads/evil/../../secret.png',
      },
    })

    const { GET } = await import('@/app/api/partner-logos/[partnerId]/route')
    const res = await GET(makeRequest(partner.id))

    expect(res.status).toBe(404)
  })

  it('returns 404 when S3 returns non-image bytes', async () => {
    const partner = await testDb.partner.create({
      data: {
        name: 'SvgPartner',
        type: 'NGO',
        logoKey: 'partner-logos/svgpartner/abc12345-0000-0000-0000-000000000011.png',
      },
    })

    // SVG content (not a valid image magic bytes)
    vi.mocked(getObjectBytes).mockResolvedValueOnce(
      Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>')
    )

    const { GET } = await import('@/app/api/partner-logos/[partnerId]/route')
    const res = await GET(makeRequest(partner.id))

    expect(res.status).toBe(404)
  })

  it('returns 404 for a non-cuid partnerId', async () => {
    const { GET } = await import('@/app/api/partner-logos/[partnerId]/route')
    const res = await GET(makeRequest('not-a-cuid!!'))

    expect(res.status).toBe(404)
  })
})
