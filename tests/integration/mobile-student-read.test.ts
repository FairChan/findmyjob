/**
 * MA1-T04：/api/m/v1 学生端只读端点。走真实的 route() 包装（App origin、版本门控、角色），
 * 会话用 mock，数据库是隔离测试库。重点断言：列表和 preview 不产生 JobView、不扣额度；
 * 响应里没有隐藏薪资、别人的联系方式和企业内部备注。
 */
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'

vi.mock('@/server/auth', () => ({ getSession: vi.fn(), auth: {} }))
vi.mock('@/server/db', async () => {
  const { testDb } = await import('../setup/db')
  return { db: testDb }
})

import { setupTestDb, testDb } from '../setup/db'
import { createStudent, createEmployer, createJob } from '../factories'
import { APP_ORIGIN, BROWSER_ORIGIN, appRequest, grantLegalConsent, mockSession, readJson } from '../helpers/mobile-api'
import { clearSettingsCache } from '@/server/services/settings'
import { getQuota } from '@/server/services/job-view-quota'
import {
  mobileApplicationListSchema,
  mobileApplicationTimelineSchema,
  mobileCompanyDetailSchema,
  mobileCompanyPageSchema,
  mobileInvitationListSchema,
  mobileJobPageSchema,
  mobileJobPreviewSchema,
  mobileNotificationPageSchema,
  mobileProfileCompletenessSchema,
  mobileProfileSchema,
  mobileReferralsSchema,
  mobileSchoolListSchema,
} from '@/shared/mobile-api'
import { GET as getProfile } from '@/app/api/m/v1/profile/route'
import { GET as getCompleteness } from '@/app/api/m/v1/profile/completeness/route'
import { GET as getSchools } from '@/app/api/m/v1/schools/route'
import { GET as getJobs } from '@/app/api/m/v1/jobs/route'
import { GET as getPreview } from '@/app/api/m/v1/jobs/[id]/preview/route'
import { GET as getCompanies } from '@/app/api/m/v1/companies/route'
import { GET as getCompany } from '@/app/api/m/v1/companies/[id]/route'
import { GET as getNotifications } from '@/app/api/m/v1/notifications/route'
import { GET as getApplications } from '@/app/api/m/v1/applications/route'
import { GET as getTimeline } from '@/app/api/m/v1/applications/[id]/timeline/route'
import { GET as getInvitations } from '@/app/api/m/v1/invitations/route'
import { GET as getReferrals } from '@/app/api/m/v1/referrals/me/route'

setupTestDb()

const MISSING_ID = 'c' + '0'.repeat(24)

beforeEach(() => {
  clearSettingsCache()
  vi.stubEnv('MOBILE_APP_ORIGINS', APP_ORIGIN)
  vi.stubEnv('APP_URL', 'https://findmyjob.example.test')
})
afterEach(() => vi.unstubAllEnvs())

async function student() {
  const s = await createStudent(testDb)
  await grantLegalConsent(testDb, s.userId)
  mockSession(s.userId)
  return s
}

async function verifiedCompanyWithJob(opts: { salaryVisible?: boolean } = {}) {
  const e = await createEmployer(testDb)
  await testDb.company.update({ where: { id: e.companyId }, data: { verificationStatus: 'VERIFIED' } })
  const job = await createJob(testDb, e.companyId, e.userId)
  await testDb.job.update({
    where: { id: job.id },
    data: { salaryMin: 3000, salaryMax: 4500, salaryVisible: opts.salaryVisible ?? true, publishedAt: new Date() },
  })
  return { ...e, jobId: job.id }
}

type Handler = (req: Request) => Promise<Response>
type Case = { name: string; handler: Handler; path: (ids: { jobId: string; companyId: string; applicationId: string }) => string }

// 每个只读端点都过同一套边界：匿名 403、企业账号 403、浏览器 Origin 403、缺版本头 426
const CASES: Case[] = [
  { name: 'GET /profile', handler: getProfile, path: () => '/api/m/v1/profile' },
  { name: 'GET /profile/completeness', handler: getCompleteness, path: () => '/api/m/v1/profile/completeness' },
  { name: 'GET /schools', handler: getSchools, path: () => '/api/m/v1/schools' },
  { name: 'GET /jobs', handler: getJobs, path: () => '/api/m/v1/jobs' },
  { name: 'GET /jobs/:id/preview', handler: getPreview, path: (i) => `/api/m/v1/jobs/${i.jobId}/preview` },
  { name: 'GET /companies', handler: getCompanies, path: () => '/api/m/v1/companies' },
  { name: 'GET /companies/:id', handler: getCompany, path: (i) => `/api/m/v1/companies/${i.companyId}` },
  { name: 'GET /notifications', handler: getNotifications, path: () => '/api/m/v1/notifications' },
  { name: 'GET /applications', handler: getApplications, path: () => '/api/m/v1/applications' },
  { name: 'GET /applications/:id/timeline', handler: getTimeline, path: (i) => `/api/m/v1/applications/${i.applicationId}/timeline` },
  { name: 'GET /invitations', handler: getInvitations, path: () => '/api/m/v1/invitations' },
  { name: 'GET /referrals/me', handler: getReferrals, path: () => '/api/m/v1/referrals/me' },
]

describe('student read endpoints: route boundary', () => {
  for (const c of CASES) {
    it(`${c.name}: anonymous, employer, browser origin and missing version are rejected; student gets 200`, async () => {
      const co = await verifiedCompanyWithJob()
      const s = await createStudent(testDb)
      await grantLegalConsent(testDb, s.userId)
      const app = await testDb.application.create({ data: { jobId: co.jobId, studentId: s.profileId } })
      const path = c.path({ jobId: co.jobId, companyId: co.companyId, applicationId: app.id })

      mockSession(null)
      const anon = await c.handler(appRequest(path))
      expect(anon.status).toBe(403)
      expect(anon.headers.get('cache-control')).toBe('private, no-store')

      mockSession(co.userId)
      expect((await c.handler(appRequest(path))).status).toBe(403)

      mockSession(s.userId)
      expect((await c.handler(appRequest(path, { headers: { origin: BROWSER_ORIGIN } }))).status).toBe(403)
      // 前缀相同但不完全相等的 scheme 也不行
      expect((await c.handler(appRequest(path, { headers: { 'expo-origin': 'findmyjob-dev-evil://' } }))).status).toBe(403)
      const noVersion = new Request(`http://localhost:3000${path}`, { headers: { 'expo-origin': APP_ORIGIN } })
      expect((await c.handler(noVersion)).status).toBe(426)

      const ok = await c.handler(appRequest(path))
      expect(ok.status).toBe(200)
      expect(ok.headers.get('cache-control')).toBe('private, no-store')
      expect(ok.headers.get('x-robots-tag')).toContain('noindex')
      expect((await readJson(ok)).ok).toBe(true)
    })
  }

  it('invalid query and path parameters are 400 VALIDATION_ERROR', async () => {
    await student()
    const bad: Array<[Handler, string]> = [
      [getJobs, '/api/m/v1/jobs?type=NOPE'],
      [getJobs, '/api/m/v1/jobs?salary=-5'],
      [getJobs, '/api/m/v1/jobs?tags=FORTUNE_500,NOT_A_TAG'],
      [getJobs, '/api/m/v1/jobs?unknownParam=1'],
      [getPreview, '/api/m/v1/jobs/not-a-cuid/preview'],
      [getCompanies, '/api/m/v1/companies?tag=EVIL'],
      [getCompanies, '/api/m/v1/companies?cursor=xyz'],
      [getCompany, '/api/m/v1/companies/not-a-cuid'],
      [getCompany, `/api/m/v1/companies/${MISSING_ID}?jobsCursor=bad`],
      [getNotifications, '/api/m/v1/notifications?cursor=bad'],
      [getNotifications, `/api/m/v1/notifications?cursor=${MISSING_ID}`],
      [getTimeline, '/api/m/v1/applications/bad/timeline'],
    ]
    for (const [handler, path] of bad) {
      const res = await handler(appRequest(path))
      expect(res.status, path).toBe(400)
      expect((await readJson(res)).code, path).toBe('VALIDATION_ERROR')
    }
  })

  it('unknown ids are 404 and another student’s application timeline is 404', async () => {
    const co = await verifiedCompanyWithJob()
    const other = await createStudent(testDb)
    const app = await testDb.application.create({ data: { jobId: co.jobId, studentId: other.profileId } })
    await student()
    expect((await getPreview(appRequest(`/api/m/v1/jobs/${MISSING_ID}/preview`))).status).toBe(404)
    expect((await getCompany(appRequest(`/api/m/v1/companies/${MISSING_ID}`))).status).toBe(404)
    expect((await getTimeline(appRequest(`/api/m/v1/applications/${app.id}/timeline`))).status).toBe(404)
  })
})

describe('profile and completeness', () => {
  it('returns the student’s own profile in the contract shape', async () => {
    const s = await student()
    await testDb.studentProfile.update({
      where: { id: s.profileId },
      data: { headline: 'Synthetic headline', cgpa: 3.5, skills: ['TypeScript'], completeness: 40 },
    })
    await testDb.education.create({ data: { studentId: s.profileId, schoolName: 'Synthetic University', sortOrder: 0 } })
    const body = await readJson(await getProfile(appRequest('/api/m/v1/profile')))
    const profile = mobileProfileSchema.parse(body.data)
    expect(profile.fullName).toBe(s.name)
    expect(profile.cgpa).toBe(3.5)
    expect(profile.educations[0].schoolName).toBe('Synthetic University')
    // 档案读接口不带联系方式、学校邮箱和内部 id
    expect(JSON.stringify(body.data)).not.toMatch(/schoolEmail|editRevision|userId/)

    const c = mobileProfileCompletenessSchema.parse((await readJson(await getCompleteness(appRequest('/api/m/v1/profile/completeness')))).data)
    expect(c).toEqual({ completeness: 40, schoolVerified: false, hasResume: false, hasContact: false, talentPoolEnabled: false })
  })

  it('lists only active schools', async () => {
    await student()
    await testDb.school.create({ data: { nameZh: '合成大学', nameEn: 'Synthetic U', emailDomains: ['synthetic.example.test'] } })
    await testDb.school.create({ data: { nameZh: '停用大学', nameEn: 'Inactive U', emailDomains: [], active: false } })
    const list = mobileSchoolListSchema.parse((await readJson(await getSchools(appRequest('/api/m/v1/schools')))).data)
    expect(list.items.map((s) => s.nameEn)).toEqual(['Synthetic U'])
  })
})

describe('jobs: list and preview never consume quota', () => {
  it('listing every page and previewing 50 jobs leaves JobView, viewCount and quota unchanged', async () => {
    const co = await verifiedCompanyWithJob()
    for (let i = 0; i < 49; i++) await createJob(testDb, co.companyId, co.userId)
    const s = await student()
    const before = await getQuota(s.profileId)

    const seen: string[] = []
    let cursor: string | null = null
    do {
      const res = await getJobs(appRequest(`/api/m/v1/jobs${cursor ? `?cursor=${cursor}` : ''}`))
      const page = mobileJobPageSchema.parse((await readJson(res)).data)
      seen.push(...page.items.map((j) => j.id))
      cursor = page.nextCursor
    } while (cursor)
    expect(new Set(seen).size).toBe(50)

    for (const id of seen) {
      const res = await getPreview(appRequest(`/api/m/v1/jobs/${id}/preview`))
      expect(res.status).toBe(200)
      const preview = mobileJobPreviewSchema.parse((await readJson(res)).data)
      expect(preview.opensFree).toBe(false)
      expect(preview.quota.used).toBe(0)
      // 预览没有正文
      expect(JSON.stringify(preview)).not.toContain('"description"')
    }

    expect(await testDb.jobView.count()).toBe(0)
    const views = await testDb.job.aggregate({ _sum: { viewCount: true } })
    expect(views._sum.viewCount ?? 0).toBe(0)
    expect(await getQuota(s.profileId)).toEqual(before)
  })

  it('filters mirror the web search and hidden salary is null', async () => {
    const visible = await verifiedCompanyWithJob({ salaryVisible: true })
    const hidden = await verifiedCompanyWithJob({ salaryVisible: false })
    await testDb.job.update({ where: { id: hidden.jobId }, data: { type: 'FULL_TIME', title: 'Synthetic Hidden Salary Analyst' } })
    await student()

    const all = mobileJobPageSchema.parse((await readJson(await getJobs(appRequest('/api/m/v1/jobs')))).data)
    const hiddenItem = all.items.find((j) => j.id === hidden.jobId)!
    expect(hiddenItem.salaryMin).toBeNull()
    expect(hiddenItem.salaryMax).toBeNull()
    expect(all.items.find((j) => j.id === visible.jobId)!.salaryMax).toBe(4500)

    const ft = mobileJobPageSchema.parse((await readJson(await getJobs(appRequest('/api/m/v1/jobs?type=FULL_TIME')))).data)
    expect(ft.items.map((j) => j.id)).toEqual([hidden.jobId])
    const q = mobileJobPageSchema.parse((await readJson(await getJobs(appRequest('/api/m/v1/jobs?q=Synthetic%20Hidden')))).data)
    expect(q.items.map((j) => j.id)).toContain(hidden.jobId)
    // 薪资筛选排除隐藏薪资的职位（与 Web 一致）
    const band = mobileJobPageSchema.parse((await readJson(await getJobs(appRequest('/api/m/v1/jobs?salary=4000')))).data)
    expect(band.items.map((j) => j.id)).toEqual([visible.jobId])

    const preview = mobileJobPreviewSchema.parse((await readJson(await getPreview(appRequest(`/api/m/v1/jobs/${hidden.jobId}/preview`)))).data)
    expect(preview.job.salaryMin).toBeNull()
    expect(preview.job.salaryMax).toBeNull()
  })

  it('preview is 404 for drafts, expired jobs and inactive companies, and reports opensFree for applied or invited jobs', async () => {
    const co = await verifiedCompanyWithJob()
    const draft = await createJob(testDb, co.companyId, co.userId, { status: 'DRAFT' })
    const expired = await createJob(testDb, co.companyId, co.userId)
    await testDb.job.update({ where: { id: expired.id }, data: { deadline: new Date(Date.now() - 1000) } })
    const invited = await createJob(testDb, co.companyId, co.userId)
    const s = await student()
    await testDb.application.create({ data: { jobId: co.jobId, studentId: s.profileId } })
    await testDb.invitation.create({
      data: { companyId: co.companyId, jobId: invited.id, studentId: s.profileId, sentById: co.userId, expiresAt: new Date(Date.now() + 86_400_000) },
    })

    expect((await getPreview(appRequest(`/api/m/v1/jobs/${draft.id}/preview`))).status).toBe(404)
    expect((await getPreview(appRequest(`/api/m/v1/jobs/${expired.id}/preview`))).status).toBe(404)
    const applied = mobileJobPreviewSchema.parse((await readJson(await getPreview(appRequest(`/api/m/v1/jobs/${co.jobId}/preview`)))).data)
    expect(applied.opensFree).toBe(true)
    const inv = mobileJobPreviewSchema.parse((await readJson(await getPreview(appRequest(`/api/m/v1/jobs/${invited.id}/preview`)))).data)
    expect(inv.opensFree).toBe(true)

    await testDb.company.update({ where: { id: co.companyId }, data: { isActive: false } })
    expect((await getPreview(appRequest(`/api/m/v1/jobs/${co.jobId}/preview`))).status).toBe(404)
    expect(await testDb.jobView.count()).toBe(0)
  })
})

describe('companies', () => {
  it('lists verified companies and shows detail without member contact data', async () => {
    const co = await verifiedCompanyWithJob({ salaryVisible: false })
    await testDb.company.update({ where: { id: co.companyId }, data: { website: 'javascript:alert(1)', description: 'Synthetic company' } })
    const unverified = await createEmployer(testDb)
    await student()

    const list = mobileCompanyPageSchema.parse((await readJson(await getCompanies(appRequest('/api/m/v1/companies')))).data)
    expect(list.items.map((c) => c.id)).toEqual([co.companyId])
    expect(list.items[0].publishedJobCount).toBe(1)
    expect((await getCompany(appRequest(`/api/m/v1/companies/${unverified.companyId}`))).status).toBe(404)

    const res = await getCompany(appRequest(`/api/m/v1/companies/${co.companyId}`))
    const raw = (await readJson(res)).data
    const detail = mobileCompanyDetailSchema.parse(raw)
    expect(detail.company.website).toBeNull()
    expect(detail.jobs.items).toHaveLength(1)
    expect(detail.jobs.items[0].salaryMin).toBeNull()
    const employer = await testDb.user.findUniqueOrThrow({ where: { id: co.userId } })
    expect(JSON.stringify(raw)).not.toContain(employer.email)
    expect(JSON.stringify(raw)).not.toMatch(/legalRegNo|verificationDocs|email|phone/i)
  })
})

describe('notifications', () => {
  it('returns own notifications without payload, paginated by cursor, with an unread count', async () => {
    const s = await student()
    const other = await createStudent(testDb)
    await testDb.notification.create({ data: { userId: other.userId, type: 'system.alert', payload: {} } })
    for (let i = 0; i < 55; i++) {
      await testDb.notification.create({
        data: {
          userId: s.userId, type: 'talent.unlock', payload: { companyName: 'Synthetic Secret Co', email: 'x@example.test' },
          createdAt: new Date(Date.now() - i * 1000), readAt: i < 5 ? new Date() : null,
        },
      })
    }
    const first = mobileNotificationPageSchema.parse((await readJson(await getNotifications(appRequest('/api/m/v1/notifications')))).data)
    expect(first.items).toHaveLength(50)
    expect(first.unreadCount).toBe(50)
    expect(JSON.stringify(first)).not.toContain('Synthetic Secret Co')
    expect(JSON.stringify(first)).not.toContain('payload')
    const second = mobileNotificationPageSchema.parse((await readJson(await getNotifications(appRequest(`/api/m/v1/notifications?cursor=${first.nextCursor}`)))).data)
    expect(second.items).toHaveLength(5)
    expect(second.nextCursor).toBeNull()
    expect(new Set([...first.items, ...second.items].map((n) => n.id)).size).toBe(55)

    // 别人的通知 id 不能当游标
    const foreign = await testDb.notification.findFirstOrThrow({ where: { userId: other.userId } })
    expect((await getNotifications(appRequest(`/api/m/v1/notifications?cursor=${foreign.id}`))).status).toBe(400)
  })
})

describe('applications and timeline', () => {
  it('lists own applications and never exposes the company note', async () => {
    const co = await verifiedCompanyWithJob()
    const s = await student()
    const app = await testDb.application.create({
      data: { jobId: co.jobId, studentId: s.profileId, status: 'INTERVIEW', companyNote: 'SYNTHETIC-INTERNAL-NOTE', coverNote: 'Hello' },
    })
    await testDb.applicationEvent.createMany({
      data: [
        { applicationId: app.id, toStatus: 'APPLIED', actorId: s.userId },
        { applicationId: app.id, fromStatus: 'APPLIED', toStatus: 'INTERVIEW', actorId: co.userId, note: 'SYNTHETIC-EVENT-NOTE' },
      ],
    })
    const listRaw = (await readJson(await getApplications(appRequest('/api/m/v1/applications')))).data
    const list = mobileApplicationListSchema.parse(listRaw)
    expect(list.items).toHaveLength(1)
    expect(list.items[0]).toMatchObject({ id: app.id, status: 'INTERVIEW', canWithdraw: true, coverNote: 'Hello' })

    const tlRaw = (await readJson(await getTimeline(appRequest(`/api/m/v1/applications/${app.id}/timeline`)))).data
    const tl = mobileApplicationTimelineSchema.parse(tlRaw)
    expect(tl.events.map((e) => e.toStatus)).toEqual(['APPLIED', 'INTERVIEW'])
    for (const raw of [listRaw, tlRaw]) {
      expect(JSON.stringify(raw)).not.toMatch(/SYNTHETIC-(INTERNAL|EVENT)-NOTE|actorId|companyNote/)
    }
  })
})

describe('invitations', () => {
  it('lists own invitations with hidden salary masked and no salaryVisible flag', async () => {
    const co = await verifiedCompanyWithJob({ salaryVisible: false })
    const s = await student()
    await testDb.invitation.create({
      data: { companyId: co.companyId, jobId: co.jobId, studentId: s.profileId, sentById: co.userId, message: 'Synthetic invite', expiresAt: new Date(Date.now() + 86_400_000) },
    })
    const raw = (await readJson(await getInvitations(appRequest('/api/m/v1/invitations')))).data
    const list = mobileInvitationListSchema.parse(raw)
    expect(list.items).toHaveLength(1)
    expect(list.items[0].job!.salaryMin).toBeNull()
    expect(list.items[0].job!.salaryMax).toBeNull()
    expect(JSON.stringify(raw)).not.toMatch(/salaryVisible|sentById/)
    const employer = await testDb.user.findUniqueOrThrow({ where: { id: co.userId } })
    expect(JSON.stringify(raw)).not.toContain(employer.email)
  })
})

describe('referrals/me', () => {
  it('returns code, link, quota and masked invitees only', async () => {
    const s = await student()
    const invitee = await createStudent(testDb, { name: 'Synthetic Fullname', completeness: 70 })
    await testDb.referral.create({ data: { referrerId: s.profileId, inviteeId: invitee.profileId, status: 'QUALIFIED' } })
    const raw = (await readJson(await getReferrals(appRequest('/api/m/v1/referrals/me')))).data
    const r = mobileReferralsSchema.parse(raw)
    expect(r.code.length).toBeGreaterThan(0)
    expect(r.inviteLink).toBe(`https://findmyjob.example.test/zh/register/student?ref=${r.code}`)
    expect(r.quota.qualified).toBe(1)
    expect(r.referrals).toHaveLength(1)
    expect(r.referrals[0].inviteeCompleteness).toBe(70)
    expect(r.referrals[0].inviteeName).not.toBe('Synthetic Fullname')
    expect(JSON.stringify(raw)).not.toContain('Synthetic Fullname')
    expect(JSON.stringify(raw)).not.toContain(invitee.email)
  })
})
