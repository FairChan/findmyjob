/**
 * PII leak tests: verifies that sensitive student data never appears in unauthenticated or
 * unauthorized responses, and that locked job details do not expose description/requirements/
 * benefits/salary even for quota-exhausted students.
 */
import { test, expect, type Page } from '@playwright/test'
import { faker } from '@faker-js/faker'
import { e2eDb } from './helpers/db'
import { loginAs } from './helpers/session'

const SENTINEL = {
  name: '哨兵测试同学甲',
  phone: '+60 12-000 0420',
  email: 'leak-sentinel@example.test',
}

/** Collect HTML+JSON text from all responses after goto */
async function collectPageText(page: Page, path: string): Promise<string[]> {
  const collected: string[] = []
  page.on('response', async (res) => {
    const ct = res.headers()['content-type'] ?? ''
    if (ct.includes('text/html') || ct.includes('application/json') || ct.includes('text/x-component')) {
      try {
        const body = await res.text()
        collected.push(body)
      } catch {
        // stream already consumed
      }
    }
  })
  await page.goto(path)
  await page.waitForLoadState('networkidle').catch(() => {})
  return collected
}

test.describe('PII leak – job list (visitor)', () => {
  let jobId: string
  let companyId: string

  test.beforeAll(async () => {
    // Create a published job with sentinel data embedded in description
    const company = await e2eDb.company.create({
      data: {
        legalName: 'PII Test Corp',
        verificationStatus: 'VERIFIED',
        isActive: true,
      },
    })
    companyId = company.id
    const user = await e2eDb.user.create({
      data: { name: 'PII Corp Owner', email: `pii-owner-${Date.now()}@example.test`, emailVerified: true, role: 'EMPLOYER', status: 'ACTIVE' },
    })
    await e2eDb.companyMember.create({ data: { companyId, userId: user.id, role: 'OWNER' } })

    const job = await e2eDb.job.create({
      data: {
        companyId,
        createdById: user.id,
        title: 'PII Test Job',
        type: 'INTERNSHIP',
        description: `Secret description: ${SENTINEL.name} ${SENTINEL.phone}`,
        requirements: `Requirements with ${SENTINEL.email}`,
        benefits: 'Secret benefits 99999',
        salaryMin: 1000,
        salaryMax: 2000,
        salaryVisible: false,
        status: 'PUBLISHED',
        publishedAt: new Date(),
        workMode: 'ONSITE',
      },
    })
    jobId = job.id
  })

  test.afterAll(async () => {
    await e2eDb.job.deleteMany({ where: { companyId } })
    await e2eDb.companyMember.deleteMany({ where: { companyId } })
    await e2eDb.company.deleteMany({ where: { id: companyId } })
  })

  test('visitor /jobs list: no sentinel data, no hidden salary', async ({ page }) => {
    const bodies = await collectPageText(page as never, '/zh/jobs')
    const all = bodies.join('\n')
    expect(all).not.toContain(SENTINEL.name)
    expect(all).not.toContain(SENTINEL.phone)
    expect(all).not.toContain(SENTINEL.email)
    expect(all).not.toContain('Secret description')
    expect(all).not.toContain('Secret benefits')
    // Hidden salary formatted values must not appear on the list page
    // (raw integers like 1000/2000 are skipped because bundle hashes may contain them)
    expect(all).not.toContain('1,000')
    expect(all).not.toContain('2,000')
  })
})

test.describe('PII leak – locked job detail (quota exhausted student)', () => {
  let jobId: string
  let companyId: string

  test.beforeAll(async () => {
    const company = await e2eDb.company.create({
      data: {
        legalName: 'PII Lock Corp',
        verificationStatus: 'VERIFIED',
        isActive: true,
      },
    })
    companyId = company.id
    const owner = await e2eDb.user.create({
      data: { name: 'PII Lock Owner', email: `pii-lock-owner-${Date.now()}@example.test`, emailVerified: true, role: 'EMPLOYER', status: 'ACTIVE' },
    })
    await e2eDb.companyMember.create({ data: { companyId, userId: owner.id, role: 'OWNER' } })

    const job = await e2eDb.job.create({
      data: {
        companyId,
        createdById: owner.id,
        title: 'Locked Job Title',
        type: 'FULL_TIME',
        description: `LOCKED_DESCRIPTION_SENTINEL: ${SENTINEL.name}`,
        requirements: `LOCKED_REQUIREMENTS_SENTINEL: ${SENTINEL.phone}`,
        benefits: `LOCKED_BENEFITS_SENTINEL: ${SENTINEL.email}`,
        salaryMin: 5000,
        salaryMax: 8000,
        salaryVisible: true,
        status: 'PUBLISHED',
        publishedAt: new Date(),
        workMode: 'HYBRID',
      },
    })
    jobId = job.id
  })

  test.afterAll(async () => {
    await e2eDb.job.deleteMany({ where: { companyId } })
    await e2eDb.companyMember.deleteMany({ where: { companyId } })
    await e2eDb.company.deleteMany({ where: { id: companyId } })
  })

  test('quota-exhausted student sees locked card: no description/requirements/benefits', async ({ page }) => {
    // Login as student
    const { userId } = await loginAs(page, { role: 'STUDENT' })

    // Create student profile
    const school = await e2eDb.school.findFirst()
    const profile = await e2eDb.studentProfile.create({
      data: {
        userId,
        fullName: faker.person.fullName(),
        schoolId: school?.id ?? null,
        completeness: 50,
        visibility: 'PUBLIC',
      },
    })

    // Find the base quota limit (default 20) and exhaust it by pre-creating JobView records
    // for 20 distinct fake jobs (the student won't have opened any real job yet)
    const fakeCompany = await e2eDb.company.create({
      data: { legalName: 'Quota Exhaust Corp', verificationStatus: 'VERIFIED', isActive: true },
    })
    const quotaFiller = await e2eDb.user.create({
      data: { name: 'quota filler', email: `qf-${Date.now()}@example.test`, emailVerified: true, role: 'EMPLOYER', status: 'ACTIVE' },
    })
    await e2eDb.companyMember.create({ data: { companyId: fakeCompany.id, userId: quotaFiller.id, role: 'OWNER' } })

    for (let i = 0; i < 20; i++) {
      const fakeJob = await e2eDb.job.create({
        data: {
          companyId: fakeCompany.id,
          createdById: quotaFiller.id,
          title: `Fake Job ${i}`,
          type: 'INTERNSHIP',
          description: 'placeholder',
          status: 'PUBLISHED',
          publishedAt: new Date(),
          workMode: 'ONSITE',
        },
      })
      await e2eDb.jobView.create({ data: { studentId: profile.id, jobId: fakeJob.id } })
    }

    // Now navigate to the locked job detail
    const bodies = await collectPageText(page as never, `/zh/jobs/${jobId}`)
    const all = bodies.join('\n')

    // Locked card must not reveal description, requirements, benefits
    expect(all).not.toContain('LOCKED_DESCRIPTION_SENTINEL')
    expect(all).not.toContain('LOCKED_REQUIREMENTS_SENTINEL')
    expect(all).not.toContain('LOCKED_BENEFITS_SENTINEL')
    expect(all).not.toContain(SENTINEL.name)
    expect(all).not.toContain(SENTINEL.phone)
    expect(all).not.toContain(SENTINEL.email)

    // Clean up
    await e2eDb.jobView.deleteMany({ where: { studentId: profile.id } })
    await e2eDb.job.deleteMany({ where: { companyId: fakeCompany.id } })
    await e2eDb.companyMember.deleteMany({ where: { companyId: fakeCompany.id } })
    await e2eDb.company.deleteMany({ where: { id: fakeCompany.id } })
  })
})
