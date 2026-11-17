/**
 * MA4-T01：/api/m/v1/e/* 企业端点。走真实 route()（App origin、版本门控、requireCompanyMember），
 * 会话 mock，数据库是隔离测试库。重点：
 * - 学生数据只经 talent-card 序列化：解锁前没有全名、联系方式、简历 id，自由文本已 redact；
 * - 查看上限、翻页上限、解锁扣点与 Web 同一套 service，计数方式一致；
 * - companyId 只来自会话，别家公司的职位、投递、学生一律拿不到。
 */
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'

vi.mock('@/server/auth', () => ({ getSession: vi.fn(), auth: {} }))
vi.mock('@/server/db', async () => {
  const { testDb } = await import('../setup/db')
  return { db: testDb }
})
vi.mock('@/server/services/notify', () => ({ sendNotificationEmail: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/server/lib/alert', () => ({ alert: vi.fn() }))

import { LedgerReason } from '@prisma/client'
import { setupTestDb, testDb } from '../setup/db'
import { createStudent, createEmployer, createJob } from '../factories'
import { APP_ORIGIN, BROWSER_ORIGIN, appRequest, grantLegalConsent, mockSession, readJson } from '../helpers/mobile-api'
import { encryptField } from '@/server/lib/crypto'
import { applyLedgerEntry } from '@/server/services/credits'
import { clearSettingsCache, setSetting } from '@/server/services/settings'
import {
  mobileApplicantDetailSchema,
  mobileApplicantListSchema,
  mobileCompanyInvitationListSchema,
  mobileEmployerJobListSchema,
  mobileTalentPageSchema,
  mobileTalentViewSchema,
  mobileUnlockResultSchema,
  mobileWalletSchema,
} from '@/shared/mobile-api'
import { GET as listJobs } from '@/app/api/m/v1/e/jobs/route'
import { POST as closeJobRoute } from '@/app/api/m/v1/e/jobs/[id]/close/route'
import { GET as listApplicants } from '@/app/api/m/v1/e/jobs/[id]/applicants/route'
import { GET as getApplicant } from '@/app/api/m/v1/e/applications/[id]/route'
import { POST as changeStatus } from '@/app/api/m/v1/e/applications/[id]/status/route'
import { POST as markViewed } from '@/app/api/m/v1/e/applications/[id]/viewed/route'
import { GET as listInvitations, POST as sendInvitationRoute } from '@/app/api/m/v1/e/invitations/route'
import { GET as searchTalent } from '@/app/api/m/v1/e/talent/route'
import { GET as viewTalent } from '@/app/api/m/v1/e/talent/[id]/route'
import { POST as unlockRoute } from '@/app/api/m/v1/e/talent/[id]/unlock/route'
import { GET as getWallet } from '@/app/api/m/v1/e/wallet/route'

setupTestDb()

const ID = 'c' + '4'.repeat(24)
const SECRET_NAME = 'Synthetic Zephyrine Quillfeather'
const SECRET_EMAIL = 'zephyrine.secret@example.test'
const SECRET_PHONE = '+60123459876'

beforeEach(() => {
  clearSettingsCache()
  vi.stubEnv('MOBILE_APP_ORIGINS', APP_ORIGIN)
})
afterEach(() => vi.unstubAllEnvs())

async function employer(opts: { verified?: boolean; credits?: number; role?: 'OWNER' | 'ADMIN' | 'RECRUITER' } = {}) {
  const e = await createEmployer(testDb)
  if (opts.verified !== false) await testDb.company.update({ where: { id: e.companyId }, data: { verificationStatus: 'VERIFIED' } })
  if (opts.role && opts.role !== 'OWNER') await testDb.companyMember.update({ where: { userId: e.userId }, data: { role: opts.role } })
  await grantLegalConsent(testDb, e.userId)
  await testDb.creditWallet.create({ data: { companyId: e.companyId } })
  if (opts.credits) {
    await testDb.$transaction((tx) => applyLedgerEntry(tx, { companyId: e.companyId, delta: opts.credits!, reason: LedgerReason.ADMIN_ADJUST }))
  }
  mockSession(e.userId)
  return e
}

/** 人才库里可见的学生：PUBLIC、完成度够、学校已认证；带联系方式、简历和含 PII 的自由文本 */
async function visibleStudent(name = SECRET_NAME) {
  const s = await createStudent(testDb, { name, completeness: 80 })
  await testDb.studentProfile.update({
    where: { id: s.profileId },
    data: {
      visibility: 'PUBLIC', schoolVerifiedAt: new Date(), lastActiveAt: new Date(),
      headline: `Hi I am ${name}, mail ${SECRET_EMAIL}`, summary: `Call ${SECRET_PHONE} or mail ${SECRET_EMAIL}`,
      skills: ['TypeScript'],
    },
  })
  await testDb.studentContact.create({
    data: {
      studentId: s.profileId,
      email: encryptField(SECRET_EMAIL, `StudentContact.email:${s.profileId}`),
      phone: encryptField(SECRET_PHONE, `StudentContact.phone:${s.profileId}`),
    },
  })
  const resume = await testDb.resumeFile.create({
    data: { studentId: s.profileId, fileName: 'synthetic.pdf', storageKey: `resumes/${s.profileId}/secret-key.pdf`, mimeType: 'application/pdf', sizeBytes: 10, isPrimary: true },
  })
  return { ...s, resumeId: resume.id, storageKey: resume.storageKey }
}

async function applicationFor(jobId: string, studentId: string) {
  // 直接建投递、不建 TalentUnlock：模拟"身份未对该企业开放"的候选人（如解锁后又被学生屏蔽前的旧数据）
  return testDb.application.create({ data: { jobId, studentId, coverNote: `I am ${SECRET_NAME}, reach me at ${SECRET_EMAIL}` } })
}

function expectNoLeak(raw: unknown, s: { email: string; resumeId: string; storageKey: string }) {
  const json = JSON.stringify(raw)
  expect(json).not.toContain(SECRET_NAME)
  expect(json).not.toContain('Zephyrine')
  expect(json).not.toContain(SECRET_EMAIL)
  expect(json).not.toContain(SECRET_PHONE)
  expect(json).not.toContain(s.email)
  expect(json).not.toContain(s.resumeId)
  expect(json).not.toContain(s.storageKey)
}

type Handler = (req: Request) => Promise<Response>
type Row = { name: string; handler: Handler; method: string; path: string; body?: unknown; bad?: { path?: string; body?: unknown } }
const ROWS: Row[] = [
  { name: 'GET /e/jobs', handler: listJobs, method: 'GET', path: '/api/m/v1/e/jobs' },
  { name: 'POST /e/jobs/:id/close', handler: closeJobRoute, method: 'POST', path: `/api/m/v1/e/jobs/${ID}/close`, bad: { path: '/api/m/v1/e/jobs/bad/close' } },
  { name: 'GET /e/jobs/:id/applicants', handler: listApplicants, method: 'GET', path: `/api/m/v1/e/jobs/${ID}/applicants`, bad: { path: '/api/m/v1/e/jobs/bad/applicants' } },
  { name: 'GET /e/applications/:id', handler: getApplicant, method: 'GET', path: `/api/m/v1/e/applications/${ID}`, bad: { path: '/api/m/v1/e/applications/bad' } },
  { name: 'POST /e/applications/:id/status', handler: changeStatus, method: 'POST', path: `/api/m/v1/e/applications/${ID}/status`, body: { toStatus: 'SHORTLISTED' }, bad: { body: { toStatus: 'NOPE' } } },
  { name: 'POST /e/applications/:id/viewed', handler: markViewed, method: 'POST', path: `/api/m/v1/e/applications/${ID}/viewed`, bad: { path: '/api/m/v1/e/applications/bad/viewed' } },
  { name: 'GET /e/invitations', handler: listInvitations, method: 'GET', path: '/api/m/v1/e/invitations' },
  { name: 'POST /e/invitations', handler: sendInvitationRoute, method: 'POST', path: '/api/m/v1/e/invitations', body: { studentId: ID, jobId: ID }, bad: { body: { studentId: 'bad', jobId: ID } } },
  { name: 'GET /e/talent', handler: searchTalent, method: 'GET', path: '/api/m/v1/e/talent', bad: { path: '/api/m/v1/e/talent?cursor=0' } },
  { name: 'GET /e/talent/:id', handler: viewTalent, method: 'GET', path: `/api/m/v1/e/talent/${ID}`, bad: { path: '/api/m/v1/e/talent/bad' } },
  { name: 'POST /e/talent/:id/unlock', handler: unlockRoute, method: 'POST', path: `/api/m/v1/e/talent/${ID}/unlock`, bad: { path: '/api/m/v1/e/talent/bad/unlock' } },
  { name: 'GET /e/wallet', handler: getWallet, method: 'GET', path: '/api/m/v1/e/wallet' },
]

function req(row: Row, o: { path?: string; body?: unknown; headers?: Record<string, string> } = {}) {
  const body = 'body' in o ? o.body : row.body
  return appRequest(o.path ?? row.path, { method: row.method, ...(body !== undefined ? { body } : {}), headers: o.headers })
}

describe('employer endpoints: route boundary', () => {
  for (const row of ROWS) {
    it(`${row.name}: anonymous / student / employer without company / browser origin / look-alike scheme are 403`, async () => {
      const auditBefore = await testDb.auditLog.count()
      mockSession(null)
      expect((await row.handler(req(row))).status).toBe(403)
      const s = await createStudent(testDb)
      await grantLegalConsent(testDb, s.userId)
      mockSession(s.userId)
      expect((await row.handler(req(row))).status).toBe(403)
      const noCompany = await testDb.user.create({ data: { name: 'No Company', email: `nocompany-${Date.now()}@example.test`, role: 'EMPLOYER', status: 'ACTIVE' } })
      mockSession(noCompany.id)
      expect((await row.handler(req(row))).status).toBe(403)
      await employer()
      expect((await row.handler(req(row, { headers: { origin: BROWSER_ORIGIN } }))).status).toBe(403)
      expect((await row.handler(req(row, { headers: { 'expo-origin': 'findmyjob-dev-evil://' } }))).status).toBe(403)
      expect(await testDb.auditLog.count()).toBe(auditBefore)
    })
  }
  for (const row of ROWS.filter((r) => r.bad)) {
    it(`${row.name}: invalid input is 400`, async () => {
      await employer()
      const res = await row.handler(req(row, row.bad))
      expect(res.status).toBe(400)
      expect((await readJson(res)).code).toBe('VALIDATION_ERROR')
    })
  }
})

describe('unverified company', () => {
  it('can list its jobs but not applicants, talent, invitations or unlock; wallet is null', async () => {
    const e = await employer({ verified: false })
    const job = await createJob(testDb, e.companyId, e.userId)
    const s = await visibleStudent()
    expect((await listJobs(appRequest('/api/m/v1/e/jobs'))).status).toBe(200)
    expect((await listApplicants(appRequest(`/api/m/v1/e/jobs/${job.id}/applicants`))).status).toBe(403)
    expect((await searchTalent(appRequest('/api/m/v1/e/talent'))).status).toBe(403)
    expect((await viewTalent(appRequest(`/api/m/v1/e/talent/${s.profileId}`))).status).toBe(403)
    expect((await unlockRoute(appRequest(`/api/m/v1/e/talent/${s.profileId}/unlock`, { method: 'POST' }))).status).toBe(403)
    expect((await sendInvitationRoute(appRequest('/api/m/v1/e/invitations', { body: { studentId: s.profileId, jobId: job.id } }))).status).toBe(403)
    expect(mobileWalletSchema.parse((await readJson(await getWallet(appRequest('/api/m/v1/e/wallet')))).data)).toEqual({ balance: null })
    expect(await testDb.profileView.count()).toBe(0)
  })
})

describe('jobs', () => {
  it('lists only own jobs with application counts, and closes like the web', async () => {
    const other = await employer()
    const otherJob = await createJob(testDb, other.companyId, other.userId)
    const e = await employer({ role: 'RECRUITER' })
    const job = await createJob(testDb, e.companyId, e.userId)
    const draft = await createJob(testDb, e.companyId, e.userId, { status: 'DRAFT' })
    const s = await createStudent(testDb)
    await testDb.application.create({ data: { jobId: job.id, studentId: s.profileId } })

    const list = mobileEmployerJobListSchema.parse((await readJson(await listJobs(appRequest('/api/m/v1/e/jobs')))).data)
    expect(list.items.map((j) => j.id).sort()).toEqual([job.id, draft.id].sort())
    expect(list.items.find((j) => j.id === job.id)!.applicationCount).toBe(1)

    const closed = await closeJobRoute(appRequest(`/api/m/v1/e/jobs/${job.id}/close`, { method: 'POST' }))
    expect((await readJson(closed)).data).toEqual({ id: job.id, status: 'CLOSED' })
    expect((await closeJobRoute(appRequest(`/api/m/v1/e/jobs/${draft.id}/close`, { method: 'POST' }))).status).toBe(422)
    expect((await closeJobRoute(appRequest(`/api/m/v1/e/jobs/${otherJob.id}/close`, { method: 'POST' }))).status).toBe(404)
    expect((await testDb.job.findUniqueOrThrow({ where: { id: otherJob.id } })).status).toBe('PUBLISHED')
  })
})

describe('applicants and status changes', () => {
  it('lists applicants through talent-card only; locked identity has no name, contact or resume ids', async () => {
    const e = await employer()
    const job = await createJob(testDb, e.companyId, e.userId)
    const s = await visibleStudent()
    const app = await applicationFor(job.id, s.profileId)

    const listRaw = (await readJson(await listApplicants(appRequest(`/api/m/v1/e/jobs/${job.id}/applicants`)))).data
    const list = mobileApplicantListSchema.parse(listRaw)
    expect(list.items).toHaveLength(1)
    expect(list.items[0].card.unlocked).toBe(false)
    expect(list.items[0].coverNote).not.toContain(SECRET_EMAIL)
    expectNoLeak(listRaw, s)

    const detailRaw = (await readJson(await getApplicant(appRequest(`/api/m/v1/e/applications/${app.id}`)))).data
    const detail = mobileApplicantDetailSchema.parse(detailRaw)
    expect(detail.profile.contact).toBeNull()
    expect(detail.profile.resumeIds).toEqual([])
    expect(detail.profile.resumeCount).toBe(1)
    expectNoLeak(detailRaw, s)
  })

  it('an applicant who applied through the normal flow is identity-unlocked for that company, exactly like the web talent page', async () => {
    const e = await employer()
    const job = await createJob(testDb, e.companyId, e.userId)
    const s = await visibleStudent()
    const app = await applicationFor(job.id, s.profileId)
    await testDb.talentUnlock.create({ data: { companyId: e.companyId, studentId: s.profileId, unlockedById: s.userId, source: 'APPLICATION', creditsSpent: 0 } })
    const detail = mobileApplicantDetailSchema.parse((await readJson(await getApplicant(appRequest(`/api/m/v1/e/applications/${app.id}`)))).data)
    const web = mobileTalentViewSchema.parse((await readJson(await viewTalent(appRequest(`/api/m/v1/e/talent/${s.profileId}`)))).data)
    expect(detail.studentId).toBe(s.profileId)
    expect(detail.profile.unlocked).toBe(true)
    expect(detail.profile.name).toBe(SECRET_NAME)
    // profile 就是人才库详情（viewTalentProfile）的输出：解锁后联系方式经 contact-access 读出
    expect(detail.profile).toEqual(web.detail)
    expect(detail.profile.contact).toMatchObject({ email: SECRET_EMAIL })
    expect(detail.coverNote).toContain(SECRET_EMAIL)
  })

  it('applicant detail follows the web board → talent view path: withdrawn, hidden, blocked and other-company are 404', async () => {
    const e = await employer()
    const job = await createJob(testDb, e.companyId, e.userId)
    const withdrawnStudent = await visibleStudent('Synthetic Withdrawn Person')
    const withdrawn = await testDb.application.create({ data: { jobId: job.id, studentId: withdrawnStudent.profileId, status: 'WITHDRAWN' } })
    const hiddenStudent = await createStudent(testDb, { completeness: 90 })
    const hidden = await applicationFor(job.id, hiddenStudent.profileId)
    const blockedStudent = await visibleStudent('Synthetic Blocking Person')
    const blocked = await applicationFor(job.id, blockedStudent.profileId)
    await testDb.blockedCompany.create({ data: { studentId: blockedStudent.profileId, companyId: e.companyId } })
    const other = await createEmployer(testDb)
    const otherJob = await createJob(testDb, other.companyId, other.userId)
    const otherApp = await applicationFor(otherJob.id, (await visibleStudent('Synthetic Elsewhere Person')).profileId)

    for (const id of [withdrawn.id, hidden.id, blocked.id, otherApp.id, ID]) {
      const res = await getApplicant(appRequest(`/api/m/v1/e/applications/${id}`))
      expect(res.status, id).toBe(404)
    }
    // 与 Web 人才详情对同一学生的结果相同
    expect((await viewTalent(appRequest(`/api/m/v1/e/talent/${hiddenStudent.profileId}`))).status).toBe(404)
    expect((await viewTalent(appRequest(`/api/m/v1/e/talent/${blockedStudent.profileId}`))).status).toBe(404)
    expect(await testDb.profileView.count()).toBe(0)
    expect(await testDb.auditLog.count({ where: { action: 'talent.view' } })).toBe(0)
  })

  it('applicant detail counts a ProfileView once per day, audits talent.view, and hits the daily limit like the web', async () => {
    const e = await employer()
    const job = await createJob(testDb, e.companyId, e.userId)
    const a = await visibleStudent()
    const b = await visibleStudent('Synthetic Second Applicant')
    const appA = await applicationFor(job.id, a.profileId)
    const appB = await applicationFor(job.id, b.profileId)
    await setSetting('limits.profileViewsPerDay', 1)
    clearSettingsCache()

    const raw = (await readJson(await getApplicant(appRequest(`/api/m/v1/e/applications/${appA.id}`)))).data
    const first = mobileApplicantDetailSchema.parse(raw)
    expect(first.profile.unlocked).toBe(false)
    expect(first.profile.contact).toBeNull()
    expect(first.coverNote).not.toContain(SECRET_EMAIL)
    expectNoLeak(raw, a)
    expect((await getApplicant(appRequest(`/api/m/v1/e/applications/${appA.id}`))).status).toBe(200)
    // 人才库详情看同一学生也不重复计数（同一天、同一成员）
    expect((await viewTalent(appRequest(`/api/m/v1/e/talent/${a.profileId}`))).status).toBe(200)
    expect(await testDb.profileView.count({ where: { companyId: e.companyId } })).toBe(1)
    expect(await testDb.auditLog.count({ where: { action: 'talent.view' } })).toBe(3)

    const limited = await getApplicant(appRequest(`/api/m/v1/e/applications/${appB.id}`))
    expect(limited.status).toBe(429)
    expect(await testDb.auditLog.count({ where: { action: 'talent.limit.hit' } })).toBe(1)
    expect(await testDb.profileView.count({ where: { companyId: e.companyId } })).toBe(1)
  })

  it('changes status with the web state machine, notifies the student without the company note, and marks viewed', async () => {
    const e = await employer()
    const job = await createJob(testDb, e.companyId, e.userId)
    const s = await visibleStudent()
    const app = await applicationFor(job.id, s.profileId)

    expect((await markViewed(appRequest(`/api/m/v1/e/applications/${app.id}/viewed`, { method: 'POST' }))).status).toBe(200)
    expect((await testDb.application.findUniqueOrThrow({ where: { id: app.id } })).status).toBe('VIEWED')

    const res = await changeStatus(appRequest(`/api/m/v1/e/applications/${app.id}/status`, { body: { toStatus: 'SHORTLISTED', note: 'SYNTHETIC-INTERNAL' } }))
    expect(res.status).toBe(200)
    expect((await testDb.application.findUniqueOrThrow({ where: { id: app.id } })).status).toBe('SHORTLISTED')
    const events = await testDb.applicationEvent.findMany({ where: { applicationId: app.id }, orderBy: { createdAt: 'asc' } })
    expect(events.map((ev) => ev.toStatus)).toEqual(['VIEWED', 'SHORTLISTED'])
    const notes = await testDb.notification.findMany({ where: { userId: s.userId, type: 'application.status.changed' } })
    expect(notes).toHaveLength(2)
    expect(JSON.stringify(notes)).not.toContain('SYNTHETIC-INTERNAL')

    // 企业不能把投递设成 WITHDRAWN / APPLIED
    expect((await changeStatus(appRequest(`/api/m/v1/e/applications/${app.id}/status`, { body: { toStatus: 'WITHDRAWN' } }))).status).toBe(422)
    await testDb.application.update({ where: { id: app.id }, data: { status: 'WITHDRAWN' } })
    expect((await changeStatus(appRequest(`/api/m/v1/e/applications/${app.id}/status`, { body: { toStatus: 'OFFER' } }))).status).toBe(403)
  })
})

describe('invitations', () => {
  it('sends idempotently to a visible student and lists with masked cards and monthly usage', async () => {
    const e = await employer()
    const job = await createJob(testDb, e.companyId, e.userId)
    const s = await visibleStudent()
    const hidden = await createStudent(testDb)

    const first = await sendInvitationRoute(appRequest('/api/m/v1/e/invitations', { body: { studentId: s.profileId, jobId: job.id, message: 'Synthetic invite' } }))
    expect(first.status).toBe(200)
    const { invitationId, alreadyExists } = (await readJson(first)).data
    expect(alreadyExists).toBe(false)
    const again = (await readJson(await sendInvitationRoute(appRequest('/api/m/v1/e/invitations', { body: { studentId: s.profileId, jobId: job.id } })))).data
    expect(again).toEqual({ invitationId, alreadyExists: true })
    expect((await sendInvitationRoute(appRequest('/api/m/v1/e/invitations', { body: { studentId: hidden.profileId, jobId: job.id } }))).status).toBe(404)
    expect(await testDb.notification.count({ where: { userId: s.userId, type: 'invitation.received' } })).toBe(1)

    const raw = (await readJson(await listInvitations(appRequest('/api/m/v1/e/invitations')))).data
    const list = mobileCompanyInvitationListSchema.parse(raw)
    expect(list.items).toHaveLength(1)
    expect(list.usage.used).toBe(1)
    expectNoLeak(raw, s)
  })
})

describe('talent search, view and unlock', () => {
  it('search returns masked cards, paginates by page cursor and respects the page cap and daily page limit', async () => {
    const e = await employer()
    const first = await visibleStudent()
    for (let i = 0; i < 20; i++) await visibleStudent(`Synthetic Student${i} Tester`)
    void e
    const p1raw = (await readJson(await searchTalent(appRequest('/api/m/v1/e/talent')))).data
    const p1 = mobileTalentPageSchema.parse(p1raw)
    expect(p1.items).toHaveLength(20)
    expect(p1.total).toBe(21)
    expect(p1.nextCursor).toBe('2')
    const p2 = mobileTalentPageSchema.parse((await readJson(await searchTalent(appRequest('/api/m/v1/e/talent?cursor=2')))).data)
    expect(p2.items).toHaveLength(1)
    expect(p2.nextCursor).toBeNull()
    expectNoLeak(p1raw, first)
    expect(p1.items.every((c) => !c.unlocked)).toBe(true)

    await setSetting('talentSearch.maxPage', 1)
    clearSettingsCache()
    const capped = mobileTalentPageSchema.parse((await readJson(await searchTalent(appRequest('/api/m/v1/e/talent')))).data)
    expect(capped.nextCursor).toBeNull()
    expect((await searchTalent(appRequest('/api/m/v1/e/talent?cursor=2'))).status).toBe(422)

    await setSetting('limits.searchPagesPerDay', 3)
    clearSettingsCache()
    expect((await searchTalent(appRequest('/api/m/v1/e/talent'))).status).toBe(429)
    const hits = await testDb.auditLog.findMany({ where: { action: 'talent.limit.hit' } })
    expect(hits).toHaveLength(1)
    expect(hits[0].metadata).toMatchObject({ kind: 'searchPages', client: 'android' })
  })

  it('view counts ProfileView once per day and hits the member limit like the web', async () => {
    const e = await employer()
    const a = await visibleStudent()
    const b = await visibleStudent('Synthetic Other Person')
    await setSetting('limits.profileViewsPerDay', 1)
    clearSettingsCache()
    const raw = (await readJson(await viewTalent(appRequest(`/api/m/v1/e/talent/${a.profileId}`)))).data
    const view = mobileTalentViewSchema.parse(raw)
    expect(view.detail.unlocked).toBe(false)
    expect(view.detail.contact).toBeNull()
    expect(view.detail.resumeIds).toEqual([])
    expect(view.unlock).toEqual({ enabled: true, costCredits: 1 })
    expectNoLeak(raw, a)
    // 同一学生当天再看不重复计数
    expect((await viewTalent(appRequest(`/api/m/v1/e/talent/${a.profileId}`))).status).toBe(200)
    expect(await testDb.profileView.count({ where: { companyId: e.companyId } })).toBe(1)
    expect((await viewTalent(appRequest(`/api/m/v1/e/talent/${b.profileId}`))).status).toBe(429)
    const audits = await testDb.auditLog.findMany({ where: { action: 'talent.view' } })
    expect(audits).toHaveLength(2)
    expect(audits[0].metadata).toMatchObject({ companyId: e.companyId, client: 'android' })
  })

  it('unlock charges once through the ledger, is idempotent, then reveals identity and contact', async () => {
    const e = await employer({ credits: 2 })
    const s = await visibleStudent()
    const first = mobileUnlockResultSchema.parse((await readJson(await unlockRoute(appRequest(`/api/m/v1/e/talent/${s.profileId}/unlock`, { method: 'POST' })))).data)
    expect(first).toMatchObject({ alreadyUnlocked: false, balance: 1 })
    const second = mobileUnlockResultSchema.parse((await readJson(await unlockRoute(appRequest(`/api/m/v1/e/talent/${s.profileId}/unlock`, { method: 'POST' })))).data)
    expect(second).toMatchObject({ alreadyUnlocked: true, balance: 1, unlockId: first.unlockId })
    expect(await testDb.creditLedger.count({ where: { wallet: { companyId: e.companyId } } })).toBe(2)
    expect(mobileWalletSchema.parse((await readJson(await getWallet(appRequest('/api/m/v1/e/wallet')))).data)).toEqual({ balance: 1 })
    const [audit] = await testDb.auditLog.findMany({ where: { action: 'talent.unlock' } })
    expect(audit.metadata).toMatchObject({ client: 'android' })

    const view = mobileTalentViewSchema.parse((await readJson(await viewTalent(appRequest(`/api/m/v1/e/talent/${s.profileId}`)))).data)
    expect(view.detail.unlocked).toBe(true)
    expect(view.detail.name).toBe(SECRET_NAME)
    expect(view.detail.contact).toMatchObject({ email: SECRET_EMAIL, phone: SECRET_PHONE })
    expect(view.detail.resumeIds).toEqual([s.resumeId])
    expect(await testDb.auditLog.count({ where: { action: 'contact.read' } })).toBe(1)
  })

  it('unlock without credits is 402 and writes nothing; a hidden or blocked student is 404', async () => {
    const e = await employer()
    const s = await visibleStudent()
    const res = await unlockRoute(appRequest(`/api/m/v1/e/talent/${s.profileId}/unlock`, { method: 'POST' }))
    expect(res.status).toBe(402)
    expect((await readJson(res)).code).toBe('INSUFFICIENT_CREDITS')
    expect(await testDb.talentUnlock.count()).toBe(0)
    await testDb.blockedCompany.create({ data: { studentId: s.profileId, companyId: e.companyId } })
    expect((await viewTalent(appRequest(`/api/m/v1/e/talent/${s.profileId}`))).status).toBe(404)
    expect((await unlockRoute(appRequest(`/api/m/v1/e/talent/${s.profileId}/unlock`, { method: 'POST' }))).status).toBe(404)
  })
})
