/**
 * MA1-T05：/api/m/v1 学生端写端点。走真实 route()（App origin、版本门控、角色、zod），会话 mock，
 * 数据库是隔离测试库；外部 IO（学校邮件、导出队列、注销邮件）mock 掉。
 * 重点：open 只经 job-view-quota 扣额度、与 Web 规则一致；Web 会写的审计 App 也写，并带 client: 'android'。
 */
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'

vi.mock('@/server/auth', () => ({ getSession: vi.fn(), auth: {} }))
vi.mock('@/server/db', async () => {
  const { testDb } = await import('../setup/db')
  return { db: testDb }
})
const mockSendEmail = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))
vi.mock('@/lib/email', () => ({ createEmailProvider: () => ({ sendEmail: mockSendEmail }) }))
vi.mock('@/server/jobs/boss', () => ({
  sendBoss: { start: vi.fn().mockResolvedValue(undefined), send: vi.fn().mockResolvedValue('synthetic-job') },
}))
vi.mock('@/server/services/notify', () => ({ sendNotificationEmail: vi.fn().mockResolvedValue(undefined) }))

import { setupTestDb, testDb } from '../setup/db'
import { createStudent, createEmployer, createJob } from '../factories'
import { seedApplicationMaterials } from '../helpers/application-materials'
import { APP_ORIGIN, BROWSER_ORIGIN, LEGAL_VERSION, appRequest, grantLegalConsent, mockSession, readJson } from '../helpers/mobile-api'
import { clearSettingsCache, setSetting } from '@/server/services/settings'
import { getQuota } from '@/server/services/job-view-quota'
import { addBlockedCompany } from '@/server/services/privacy'
import {
  mobileApplicationRefSchema,
  mobileDataExportSchema,
  mobileJobOpenSchema,
  mobileNotificationPrefsSchema,
  mobilePrivacySchema,
  mobileProfileCompletenessSchema,
  mobileProfileSchema,
} from '@/shared/mobile-api'
import { PUT as putBasic } from '@/app/api/m/v1/profile/basic/route'
import { PUT as putPreferences } from '@/app/api/m/v1/profile/preferences/route'
import { PUT as putSkills } from '@/app/api/m/v1/profile/skills/route'
import { PUT as putExperience } from '@/app/api/m/v1/profile/experience/route'
import { GET as getProfile } from '@/app/api/m/v1/profile/route'
import { GET as getCompleteness } from '@/app/api/m/v1/profile/completeness/route'
import { POST as sendOtp } from '@/app/api/m/v1/school-verification/send/route'
import { POST as confirmOtp } from '@/app/api/m/v1/school-verification/confirm/route'
import { POST as openJobRoute } from '@/app/api/m/v1/jobs/[id]/open/route'
import { POST as apply } from '@/app/api/m/v1/applications/route'
import { POST as withdraw } from '@/app/api/m/v1/applications/[id]/withdraw/route'
import { POST as acceptInv } from '@/app/api/m/v1/invitations/[id]/accept/route'
import { POST as declineInv } from '@/app/api/m/v1/invitations/[id]/decline/route'
import { POST as markRead } from '@/app/api/m/v1/notifications/read/route'
import { GET as getPrivacy, PUT as putPrivacy } from '@/app/api/m/v1/privacy/route'
import { GET as searchCompanies } from '@/app/api/m/v1/privacy/companies/route'
import { POST as blockCompany } from '@/app/api/m/v1/privacy/blocked-companies/route'
import { DELETE as unblockCompany } from '@/app/api/m/v1/privacy/blocked-companies/[companyId]/route'
import { POST as requestExportRoute } from '@/app/api/m/v1/data-requests/export/route'
import { POST as deleteAccount } from '@/app/api/m/v1/account/delete/route'
import { PATCH as patchLocale } from '@/app/api/m/v1/me/locale/route'
import { GET as getPrefs, PUT as putPrefs } from '@/app/api/m/v1/me/notification-prefs/route'

setupTestDb()

const ID = 'c' + '1'.repeat(24)

beforeEach(async () => {
  clearSettingsCache()
  vi.stubEnv('MOBILE_APP_ORIGINS', APP_ORIGIN)
  mockSendEmail.mockClear()
  await setSetting('legal.currentVersion', LEGAL_VERSION)
  clearSettingsCache()
})
afterEach(() => vi.unstubAllEnvs())

async function student(opts: { completeness?: number; materials?: boolean } = {}) {
  const s = await createStudent(testDb, { completeness: opts.completeness ?? 0 })
  await grantLegalConsent(testDb, s.userId)
  if (opts.materials) await seedApplicationMaterials(testDb, s.profileId)
  mockSession(s.userId)
  return s
}

async function verifiedCompany() {
  const e = await createEmployer(testDb)
  await testDb.company.update({ where: { id: e.companyId }, data: { verificationStatus: 'VERIFIED' } })
  return e
}

async function auditsFor(action: string) {
  return testDb.auditLog.findMany({ where: { action }, orderBy: { createdAt: 'asc' } })
}

type Handler = (req: Request) => Promise<Response>
type Row = {
  name: string
  handler: Handler
  method: string
  path: string
  body?: unknown
  bad: { path?: string; body?: unknown }
  employerStatus?: number
}

// 每个写端点：匿名 403、企业账号 403、浏览器 Origin 403（什么都不写）、非法输入 400
const ROWS: Row[] = [
  { name: 'PUT /profile/basic', handler: putBasic, method: 'PUT', path: '/api/m/v1/profile/basic', body: { fullName: 'Synthetic', workAuth: 'STUDENT_PASS' }, bad: { body: { fullName: '' } } },
  { name: 'PUT /profile/preferences', handler: putPreferences, method: 'PUT', path: '/api/m/v1/profile/preferences', body: { intents: ['INTERNSHIP'] }, bad: { body: { intents: [] } } },
  { name: 'PUT /profile/skills', handler: putSkills, method: 'PUT', path: '/api/m/v1/profile/skills', body: { languages: [], skills: [] }, bad: { body: { languages: 'English', skills: [] } } },
  { name: 'PUT /profile/experience', handler: putExperience, method: 'PUT', path: '/api/m/v1/profile/experience', body: { educations: [], experiences: [] }, bad: { body: { educations: [{}], experiences: [] } } },
  { name: 'POST /school-verification/send', handler: sendOtp, method: 'POST', path: '/api/m/v1/school-verification/send', body: { schoolId: ID, schoolEmail: 'a@example.test' }, bad: { body: { schoolId: ID, schoolEmail: 'not-an-email' } } },
  { name: 'POST /school-verification/confirm', handler: confirmOtp, method: 'POST', path: '/api/m/v1/school-verification/confirm', body: { otp: '123456' }, bad: { body: {} } },
  { name: 'POST /jobs/:id/open', handler: openJobRoute, method: 'POST', path: `/api/m/v1/jobs/${ID}/open`, bad: { path: '/api/m/v1/jobs/bad-id/open' } },
  { name: 'POST /applications', handler: apply, method: 'POST', path: '/api/m/v1/applications', body: { jobId: ID }, bad: { body: { jobId: 'bad' } } },
  { name: 'POST /applications/:id/withdraw', handler: withdraw, method: 'POST', path: `/api/m/v1/applications/${ID}/withdraw`, bad: { path: '/api/m/v1/applications/bad/withdraw' } },
  { name: 'POST /invitations/:id/accept', handler: acceptInv, method: 'POST', path: `/api/m/v1/invitations/${ID}/accept`, bad: { path: '/api/m/v1/invitations/bad/accept' } },
  { name: 'POST /invitations/:id/decline', handler: declineInv, method: 'POST', path: `/api/m/v1/invitations/${ID}/decline`, bad: { path: '/api/m/v1/invitations/bad/decline' } },
  { name: 'POST /notifications/read', handler: markRead, method: 'POST', path: '/api/m/v1/notifications/read', body: { all: true }, bad: { body: { ids: [] } } },
  { name: 'PUT /privacy', handler: putPrivacy, method: 'PUT', path: '/api/m/v1/privacy', body: { granted: false }, bad: { body: { granted: 'yes' } } },
  { name: 'GET /privacy', handler: getPrivacy, method: 'GET', path: '/api/m/v1/privacy', bad: {} },
  { name: 'GET /privacy/companies', handler: searchCompanies, method: 'GET', path: '/api/m/v1/privacy/companies?query=x', bad: { path: '/api/m/v1/privacy/companies' } },
  { name: 'POST /privacy/blocked-companies', handler: blockCompany, method: 'POST', path: '/api/m/v1/privacy/blocked-companies', body: { companyId: ID }, bad: { body: { companyId: 'bad' } } },
  { name: 'DELETE /privacy/blocked-companies/:id', handler: unblockCompany, method: 'DELETE', path: `/api/m/v1/privacy/blocked-companies/${ID}`, bad: { path: '/api/m/v1/privacy/blocked-companies/bad' } },
  { name: 'POST /data-requests/export', handler: requestExportRoute, method: 'POST', path: '/api/m/v1/data-requests/export', body: {}, bad: { body: { extra: 1 } } },
  { name: 'POST /account/delete', handler: deleteAccount, method: 'POST', path: '/api/m/v1/account/delete', body: { confirm: true }, bad: { body: {} } },
  { name: 'PATCH /me/locale', handler: patchLocale, method: 'PATCH', path: '/api/m/v1/me/locale', body: { locale: 'en' }, bad: { body: { locale: 'fr' } }, employerStatus: 200 },
  { name: 'GET /me/notification-prefs', handler: getPrefs, method: 'GET', path: '/api/m/v1/me/notification-prefs', bad: {} },
  { name: 'PUT /me/notification-prefs', handler: putPrefs, method: 'PUT', path: '/api/m/v1/me/notification-prefs', body: { granted: false }, bad: { body: { granted: true } } },
]

function req(row: Row, override: { path?: string; body?: unknown; headers?: Record<string, string> } = {}) {
  const body = 'body' in override ? override.body : row.body
  return appRequest(override.path ?? row.path, { method: row.method, ...(body !== undefined ? { body } : {}), headers: override.headers })
}

describe('student write endpoints: route boundary', () => {
  for (const row of ROWS) {
    it(`${row.name}: anonymous / employer / browser origin are rejected without side effects`, async () => {
      // beforeEach 的 setSetting 自己会写一条 setting.update 审计
      const auditBefore = await testDb.auditLog.count()
      mockSession(null)
      expect((await row.handler(req(row))).status).toBe(403)
      await student()
      expect((await row.handler(req(row, { headers: { origin: BROWSER_ORIGIN } }))).status).toBe(403)
      expect((await row.handler(req(row, { headers: { origin: 'findmyjob-dev-evil://' } }))).status).toBe(403)
      expect(await testDb.auditLog.count()).toBe(auditBefore)

      const e = await createEmployer(testDb)
      await grantLegalConsent(testDb, e.userId)
      mockSession(e.userId)
      expect((await row.handler(req(row))).status).toBe(row.employerStatus ?? 403)
    })
  }

  for (const row of ROWS.filter((r) => r.bad.path || r.bad.body !== undefined)) {
    it(`${row.name}: invalid input is 400 VALIDATION_ERROR`, async () => {
      await student()
      const res = await row.handler(req(row, row.bad))
      expect(res.status).toBe(400)
      expect((await readJson(res)).code).toBe('VALIDATION_ERROR')
    })
  }

  for (const row of ROWS.filter((r) => r.body !== undefined)) {
    it(`${row.name}: malformed JSON is 400 INVALID_JSON`, async () => {
      await student()
      const res = await row.handler(appRequest(row.path, { method: row.method, rawBody: '{not json' }))
      expect(res.status).toBe(400)
      expect((await readJson(res)).code).toBe('INVALID_JSON')
    })
  }
})

describe('profile sections', () => {
  it('each section saves through the web service and the profile reflects it', async () => {
    const s = await student()
    const school = await testDb.school.create({ data: { nameZh: '合成大学', nameEn: 'Synthetic U', emailDomains: ['synthetic.example.test'] } })
    const ok = async (h: Handler, path: string, body: unknown) => {
      const res = await h(appRequest(path, { method: 'PUT', body }))
      expect(res.status, path).toBe(200)
    }
    await ok(putBasic, '/api/m/v1/profile/basic', { fullName: 'Synthetic Student', schoolId: school.id, workAuth: 'STUDENT_PASS', cgpa: 3.2, nationality: 'cn' })
    await ok(putPreferences, '/api/m/v1/profile/preferences', { intents: ['INTERNSHIP', 'PART_TIME'], preferredStates: ['KUL'] })
    await ok(putSkills, '/api/m/v1/profile/skills', { languages: [{ language: 'English', level: 'FLUENT' }], skills: ['TypeScript'], headline: 'Synthetic headline' })
    await ok(putExperience, '/api/m/v1/profile/experience', {
      educations: [{ schoolName: 'Synthetic U', degreeLevel: 'BACHELOR' }],
      experiences: [{ kind: 'PROJECT', title: 'Synthetic project' }, { kind: 'WORK', title: 'Synthetic job' }],
    })
    const p = mobileProfileSchema.parse((await readJson(await getProfile(appRequest('/api/m/v1/profile')))).data)
    expect(p).toMatchObject({ fullName: 'Synthetic Student', schoolId: school.id, nationality: 'CN', cgpa: 3.2, intents: ['INTERNSHIP', 'PART_TIME'], skills: ['TypeScript'] })
    expect(p.languages).toEqual([{ language: 'English', level: 'FLUENT' }])
    expect(p.experiences.map((e) => e.title)).toEqual(['Synthetic project', 'Synthetic job'])

    // 整组替换：提交空列表就删掉
    await ok(putExperience, '/api/m/v1/profile/experience', { educations: [], experiences: [] })
    expect(await testDb.experience.count({ where: { studentId: s.profileId } })).toBe(0)
    const c = mobileProfileCompletenessSchema.parse((await readJson(await getCompleteness(appRequest('/api/m/v1/profile/completeness')))).data)
    expect(c.completeness).toBeGreaterThan(0)

    // 不存在或已停用的学校 → service 的 ValidationError
    const bad = await putBasic(appRequest('/api/m/v1/profile/basic', { method: 'PUT', body: { fullName: 'X', schoolId: ID, workAuth: 'OTHER' } }))
    expect(bad.status).toBe(422)
  })
})

describe('school verification', () => {
  it('sends an OTP to the school mailbox and confirms it; the response never carries the code', async () => {
    const s = await student()
    const school = await testDb.school.create({ data: { nameZh: '合成大学', nameEn: 'Synthetic U', emailDomains: ['synthetic.example.test'] } })
    const wrongDomain = await sendOtp(appRequest('/api/m/v1/school-verification/send', { body: { schoolId: school.id, schoolEmail: 'me@other.example.test' } }))
    expect(wrongDomain.status).toBe(422)

    const sent = await sendOtp(appRequest('/api/m/v1/school-verification/send', { body: { schoolId: school.id, schoolEmail: 'me@synthetic.example.test' } }))
    expect(sent.status).toBe(200)
    const sentText = await sent.text()
    const otp = /code is: (\d{6})/.exec(mockSendEmail.mock.calls[0][0].text)![1]
    expect(sentText).not.toContain(otp)

    expect((await confirmOtp(appRequest('/api/m/v1/school-verification/confirm', { body: { otp: otp === '000000' ? '111111' : '000000' } }))).status).toBe(422)
    expect((await confirmOtp(appRequest('/api/m/v1/school-verification/confirm', { body: { otp } }))).status).toBe(200)
    const profile = await testDb.studentProfile.findUniqueOrThrow({ where: { id: s.profileId } })
    expect(profile.schoolVerifiedAt).not.toBeNull()
    expect(profile.schoolId).toBe(school.id)
  })
})

describe('POST /jobs/:id/open consumes quota exactly like the web detail page', () => {
  it('counts distinct new jobs, never repeats, locks when exhausted, and exempts applied/invited jobs', async () => {
    await setSetting('studentQuota.baseJobViews', 2)
    clearSettingsCache()
    const co = await verifiedCompany()
    const jobs = [] as string[]
    for (let i = 0; i < 5; i++) jobs.push((await createJob(testDb, co.companyId, co.userId)).id)
    await testDb.job.update({ where: { id: jobs[0] }, data: { salaryMin: 1000, salaryMax: 2000, salaryVisible: false, requirements: 'Synthetic req' } })
    const s = await student({ completeness: 80, materials: true })
    // jobs[3] 已投递、jobs[4] 被邀请：打开不扣额度
    await testDb.application.create({ data: { jobId: jobs[3], studentId: s.profileId } })
    await testDb.invitation.create({ data: { companyId: co.companyId, jobId: jobs[4], studentId: s.profileId, sentById: co.userId, expiresAt: new Date(Date.now() + 86_400_000) } })
    const open = async (id: string) => mobileJobOpenSchema.parse((await readJson(await openJobRoute(appRequest(`/api/m/v1/jobs/${id}/open`, { method: 'POST' })))).data)

    const first = await open(jobs[0])
    expect(first.allowed).toBe(true)
    expect(first.quota).toMatchObject({ used: 1, limit: 2 })
    expect(first.detail!.description.length).toBeGreaterThan(0)
    expect(first.detail!.requirements).toBe('Synthetic req')
    expect(first.detail!.salaryMin).toBeNull()
    expect(first.applyBlocker).toBeNull()
    expect(first.resumes).toHaveLength(1)
    expect(JSON.stringify(first)).not.toMatch(/viewCount|salaryVisible|companyId|createdById/)

    expect((await open(jobs[0])).quota.used).toBe(1) // 重复打开不重复扣
    expect((await open(jobs[1])).quota.used).toBe(2)
    const locked = await open(jobs[2])
    expect(locked.allowed).toBe(false)
    expect(locked.detail).toBeNull()
    expect(locked.job.id).toBe(jobs[2])

    const applied = await open(jobs[3])
    expect(applied.allowed).toBe(true)
    expect(applied.application).toMatchObject({ status: 'APPLIED', canWithdraw: true })
    expect((await open(jobs[4])).allowed).toBe(true)

    expect(await testDb.jobView.count({ where: { studentId: s.profileId } })).toBe(2)
    expect((await getQuota(s.profileId)).used).toBe(2)
    const counts = await testDb.job.findMany({ where: { id: { in: jobs } }, select: { id: true, viewCount: true } })
    expect(Object.fromEntries(counts.map((c) => [c.id, c.viewCount]))).toEqual({ [jobs[0]]: 1, [jobs[1]]: 1, [jobs[2]]: 0, [jobs[3]]: 0, [jobs[4]]: 0 })
    // 用完最后一个名额时发站内通知（与 Web 同一个 service）
    expect(await testDb.notification.count({ where: { userId: s.userId, type: 'quota.exhausted' } })).toBe(1)
  })

  it('is 404 for an unpublished job and reports the apply blocker', async () => {
    const co = await verifiedCompany()
    const draft = await createJob(testDb, co.companyId, co.userId, { status: 'DRAFT' })
    const job = await createJob(testDb, co.companyId, co.userId)
    await student()
    expect((await openJobRoute(appRequest(`/api/m/v1/jobs/${draft.id}/open`, { method: 'POST' }))).status).toBe(404)
    const res = mobileJobOpenSchema.parse((await readJson(await openJobRoute(appRequest(`/api/m/v1/jobs/${job.id}/open`, { method: 'POST' })))).data)
    expect(res.applyBlocker).toBe('contactAndResume')
    expect(await testDb.jobView.count()).toBe(1)
  })
})

describe('apply and withdraw', () => {
  it('requires opening first, rejects duplicates, and withdraws only own applications', async () => {
    const co = await verifiedCompany()
    const job = await createJob(testDb, co.companyId, co.userId)
    const s = await student({ completeness: 80, materials: true })

    // 没打开过（也没被邀请）就投：与 Web 一样返回 404，防止绕过额度
    expect((await apply(appRequest('/api/m/v1/applications', { body: { jobId: job.id } }))).status).toBe(404)
    await openJobRoute(appRequest(`/api/m/v1/jobs/${job.id}/open`, { method: 'POST' }))
    const res = await apply(appRequest('/api/m/v1/applications', { body: { jobId: job.id, coverNote: 'Synthetic note' } }))
    expect(res.status).toBe(200)
    const { applicationId } = mobileApplicationRefSchema.parse((await readJson(res)).data)
    expect((await apply(appRequest('/api/m/v1/applications', { body: { jobId: job.id } }))).status).toBe(409)
    expect(await testDb.talentUnlock.count({ where: { studentId: s.profileId, source: 'APPLICATION' } })).toBe(1)

    expect((await withdraw(appRequest(`/api/m/v1/applications/${applicationId}/withdraw`, { method: 'POST' }))).status).toBe(200)
    expect((await testDb.application.findUniqueOrThrow({ where: { id: applicationId } })).status).toBe('WITHDRAWN')

    const other = await student()
    void other
    expect((await withdraw(appRequest(`/api/m/v1/applications/${applicationId}/withdraw`, { method: 'POST' }))).status).toBe(404)
  })

  it('low completeness is COMPLETENESS_LOW', async () => {
    const co = await verifiedCompany()
    const job = await createJob(testDb, co.companyId, co.userId)
    await student({ completeness: 10, materials: true })
    await openJobRoute(appRequest(`/api/m/v1/jobs/${job.id}/open`, { method: 'POST' }))
    const res = await apply(appRequest('/api/m/v1/applications', { body: { jobId: job.id } }))
    expect((await readJson(res)).code).toBe('COMPLETENESS_LOW')
  })
})

describe('invitations accept / decline', () => {
  it('accepting applies without consuming quota; declining marks it declined; others’ invitations are 404', async () => {
    const co = await verifiedCompany()
    const jobA = await createJob(testDb, co.companyId, co.userId)
    const jobB = await createJob(testDb, co.companyId, co.userId)
    const s = await student({ completeness: 80, materials: true })
    const expiresAt = new Date(Date.now() + 86_400_000)
    const invA = await testDb.invitation.create({ data: { companyId: co.companyId, jobId: jobA.id, studentId: s.profileId, sentById: co.userId, expiresAt } })
    const invB = await testDb.invitation.create({ data: { companyId: co.companyId, jobId: jobB.id, studentId: s.profileId, sentById: co.userId, expiresAt } })

    const acc = await acceptInv(appRequest(`/api/m/v1/invitations/${invA.id}/accept`, { method: 'POST' }))
    expect(acc.status).toBe(200)
    const { applicationId } = mobileApplicationRefSchema.parse((await readJson(acc)).data)
    expect((await testDb.invitation.findUniqueOrThrow({ where: { id: invA.id } })).status).toBe('ACCEPTED')
    expect((await testDb.application.findUniqueOrThrow({ where: { id: applicationId } })).jobId).toBe(jobA.id)
    expect(await testDb.jobView.count()).toBe(0)

    expect((await declineInv(appRequest(`/api/m/v1/invitations/${invB.id}/decline`, { method: 'POST' }))).status).toBe(200)
    expect((await testDb.invitation.findUniqueOrThrow({ where: { id: invB.id } })).status).toBe('DECLINED')
    expect((await declineInv(appRequest(`/api/m/v1/invitations/${invB.id}/decline`, { method: 'POST' }))).status).toBe(403)

    await student()
    expect((await acceptInv(appRequest(`/api/m/v1/invitations/${invA.id}/accept`, { method: 'POST' }))).status).toBe(404)
  })
})

describe('notifications read', () => {
  it('marks only own notifications by id or all', async () => {
    const s = await student()
    const other = await createStudent(testDb)
    const mine = await testDb.notification.create({ data: { userId: s.userId, type: 'system.alert', payload: {} } })
    const mine2 = await testDb.notification.create({ data: { userId: s.userId, type: 'system.alert', payload: {} } })
    const theirs = await testDb.notification.create({ data: { userId: other.userId, type: 'system.alert', payload: {} } })
    expect((await markRead(appRequest('/api/m/v1/notifications/read', { body: { ids: [mine.id, theirs.id] } }))).status).toBe(200)
    expect((await testDb.notification.findUniqueOrThrow({ where: { id: mine.id } })).readAt).not.toBeNull()
    expect((await testDb.notification.findUniqueOrThrow({ where: { id: mine2.id } })).readAt).toBeNull()
    expect((await testDb.notification.findUniqueOrThrow({ where: { id: theirs.id } })).readAt).toBeNull()
    await markRead(appRequest('/api/m/v1/notifications/read', { body: { all: true } }))
    expect((await testDb.notification.findUniqueOrThrow({ where: { id: mine2.id } })).readAt).not.toBeNull()
    expect((await testDb.notification.findUniqueOrThrow({ where: { id: theirs.id } })).readAt).toBeNull()
  })
})

describe('privacy, blocking and audit client tagging', () => {
  it('toggles talent-pool visibility with consent + audit tagged client android', async () => {
    const s = await student()
    expect((await putPrivacy(appRequest('/api/m/v1/privacy', { method: 'PUT', body: { granted: true }, headers: { 'x-real-ip': '203.0.113.9' } }))).status).toBe(200)
    expect((await testDb.studentProfile.findUniqueOrThrow({ where: { id: s.profileId } })).visibility).toBe('PUBLIC')
    const privacy = mobilePrivacySchema.parse((await readJson(await getPrivacy(appRequest('/api/m/v1/privacy')))).data)
    expect(privacy.talentPoolVisible).toBe(true)

    await putPrivacy(appRequest('/api/m/v1/privacy', { method: 'PUT', body: { granted: false } }))
    expect((await testDb.studentProfile.findUniqueOrThrow({ where: { id: s.profileId } })).visibility).toBe('HIDDEN')
    const audits = await auditsFor('student.visibility.change')
    expect(audits).toHaveLength(2)
    expect(audits[0].metadata).toEqual({ granted: true, visibility: 'PUBLIC', client: 'android' })
    expect(audits[0].ip).toBe('203.0.113.9')
    expect(await testDb.consent.count({ where: { userId: s.userId, type: 'TALENT_POOL' } })).toBe(2)
  })

  it('opting in without current legal consent is refused like the web', async () => {
    const s = await createStudent(testDb)
    await grantLegalConsent(testDb, s.userId, 'old-version')
    mockSession(s.userId)
    // 这里只测 setVisibility 本身的规则；MA1-T07 之后同一请求会先被 409 NEEDS_RECONSENT 拦下
    const res = await putPrivacy(appRequest('/api/m/v1/privacy', { method: 'PUT', body: { granted: true } }))
    expect([403, 409]).toContain(res.status)
    expect((await testDb.studentProfile.findUniqueOrThrow({ where: { id: s.profileId } })).visibility).toBe('HIDDEN')
  })

  it('searches, blocks and unblocks companies; app audits carry client android, web audits do not', async () => {
    const co = await verifiedCompany()
    await testDb.company.update({ where: { id: co.companyId }, data: { legalName: 'Synthetic Blockable Sdn Bhd' } })
    const s = await student()
    const found = (await readJson(await searchCompanies(appRequest('/api/m/v1/privacy/companies?query=Blockable')))).data
    expect(found.items).toEqual([{ id: co.companyId, name: 'Synthetic Blockable Sdn Bhd' }])

    expect((await blockCompany(appRequest('/api/m/v1/privacy/blocked-companies', { body: { companyId: co.companyId } }))).status).toBe(200)
    const privacy = mobilePrivacySchema.parse((await readJson(await getPrivacy(appRequest('/api/m/v1/privacy')))).data)
    expect(privacy.blockedCompanies.map((b) => b.companyId)).toEqual([co.companyId])
    expect((await unblockCompany(appRequest(`/api/m/v1/privacy/blocked-companies/${co.companyId}`, { method: 'DELETE' }))).status).toBe(200)
    expect(await testDb.blockedCompany.count()).toBe(0)

    const [block] = await auditsFor('student.block_company')
    const [unblock] = await auditsFor('student.unblock_company')
    expect(block.metadata).toEqual({ studentId: s.profileId, client: 'android' })
    expect(unblock.metadata).toEqual({ studentId: s.profileId, client: 'android' })

    // 直接调 service（Web Server Action 的路径）不带来源标记
    await addBlockedCompany({ userId: s.userId }, { companyId: co.companyId })
    const all = await auditsFor('student.block_company')
    expect(all[1].metadata).toEqual({ studentId: s.profileId })
  })
})

describe('data rights', () => {
  it('requests an export (deduplicated) and audits it', async () => {
    const s = await student()
    const first = mobileDataExportSchema.parse((await readJson(await requestExportRoute(appRequest('/api/m/v1/data-requests/export', { body: {} })))).data)
    expect(first.existing).toBe(false)
    const second = mobileDataExportSchema.parse((await readJson(await requestExportRoute(appRequest('/api/m/v1/data-requests/export', { body: {} })))).data)
    expect(second).toEqual({ requestId: first.requestId, existing: true })
    const audits = await auditsFor('data.export')
    expect(audits).toHaveLength(1)
    expect(audits[0]).toMatchObject({ actorId: s.userId, targetId: first.requestId, metadata: { client: 'android' } })
  })

  it('deletes the account: DELETED, hidden, sessions revoked, audited', async () => {
    const s = await student()
    await testDb.session.create({ data: { userId: s.userId, token: 'synthetic-session-token', expiresAt: new Date(Date.now() + 86_400_000) } })
    expect((await deleteAccount(appRequest('/api/m/v1/account/delete', { body: { confirm: true } }))).status).toBe(200)
    const user = await testDb.user.findUniqueOrThrow({ where: { id: s.userId } })
    expect(user.status).toBe('DELETED')
    expect(await testDb.session.count({ where: { userId: s.userId } })).toBe(0)
    const [audit] = await auditsFor('data.delete')
    expect(audit).toMatchObject({ actorId: s.userId, metadata: { client: 'android' } })
    // 账号已注销：同一会话再调学生端点被拒
    expect((await deleteAccount(appRequest('/api/m/v1/account/delete', { body: { confirm: true } }))).status).toBe(403)
  })
})

describe('locale and notification preferences', () => {
  it('updates the own locale only', async () => {
    const s = await student()
    const res = await patchLocale(appRequest('/api/m/v1/me/locale', { method: 'PATCH', body: { locale: 'en' } }))
    expect((await readJson(res)).data).toEqual({ locale: 'en' })
    expect((await testDb.user.findUniqueOrThrow({ where: { id: s.userId } })).locale).toBe('en')
  })

  it('reads the weekly digest preference and withdraws it with an audited MARKETING consent', async () => {
    const s = await student()
    const prefs = mobileNotificationPrefsSchema.parse((await readJson(await getPrefs(appRequest('/api/m/v1/me/notification-prefs')))).data)
    expect(prefs).toEqual({ weeklyDigest: { available: false, granted: false }, legalVersion: LEGAL_VERSION })
    // 周报未开放时开启 → FEATURE_DISABLED（与 Web 一致）
    const on = await putPrefs(appRequest('/api/m/v1/me/notification-prefs', { method: 'PUT', body: { granted: true, submittedVersion: LEGAL_VERSION } }))
    expect((await readJson(on)).code).toBe('FEATURE_DISABLED')
    const off = await putPrefs(appRequest('/api/m/v1/me/notification-prefs', { method: 'PUT', body: { granted: false } }))
    expect(off.status).toBe(200)
    expect(await testDb.consent.count({ where: { userId: s.userId, type: 'MARKETING', granted: false } })).toBe(1)
    const [audit] = await auditsFor('marketing.consent')
    expect(audit.metadata).toMatchObject({ granted: false, client: 'android' })
  })
})
