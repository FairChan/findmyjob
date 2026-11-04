import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import {
  APP_STATUS_LABEL, COMPANIES, JOBS, PARTNERS, STUDENTS, companyById, daysAgo, geoOf,
  type AppStatus, type Job, type Partner, type Student,
} from './data/mock'
import { completeness, MIN_COMPLETENESS } from './lib/privacy'
import { formatDate, now, uid } from './lib/utils'
import { canViewJob, nextTier, qualifiedCount, recordJobView, viewLimit, type QuotaSettings, type Referral } from './lib/quota'
import type { SearchMode } from './lib/search'
import { DEFAULT_SALARY_BANDS } from './data/taxonomy'

// 原型里固定三个演示身份：学生 = 林雨晴，企业 = 鹭江科技的 HR 陈经理，运营 = 平台管理员
export type Role = 'guest' | 'student' | 'employer' | 'admin'
export type NoticeTo = 'student' | 'employer' | 'admin'
export const ME_ID = 's1'
export const MY_COMPANY_ID = 'c1'
export const HR_NAME = '陈经理'

export interface Application {
  id: string; jobId: string; studentId: string; status: AppStatus; createdAt: string
  note?: string; internalNote?: string; events: { status: AppStatus; at: string }[]
}
export interface Invitation {
  id: string; companyId: string; jobId: string; studentId: string; message: string
  status: 'SENT' | 'ACCEPTED' | 'DECLINED' | 'EXPIRED'; createdAt: string
}
export interface Unlock { studentId: string; source: 'CREDIT' | 'APPLICATION'; at: string; by: string }
export interface LedgerEntry { id: string; delta: number; balanceAfter: number; reason: 'PILOT_GRANT' | 'UNLOCK' | 'PURCHASE' | 'ADMIN_ADJUST'; note: string; at: string }
export interface Notice { id: string; to: NoticeTo; text: string; at: string; read: boolean; link?: string }
export interface CompanyRecord { companyId: string; at: string; source?: 'CREDIT' | 'APPLICATION' }
export interface CompanyReview {
  id: string; name: string; ssm: string; industry: string; contact: string; submittedAt: string
  files: string[]; status: 'PENDING' | 'VERIFIED' | 'REJECTED'; reason?: string
}
export interface AuditEntry { id: string; actor: string; action: string; target: string; at: string }
export interface Settings {
  billingEnabled: boolean; pilotMonthlyCredits: number; unlockCost: number
  autoPublishAfter: number; profileViewsPerDay: number; unlocksPerDay: number; invitationQuota: number
  // v2：学生额度与邀请（Q1–Q3）、投递门槛（Q4）、注册上限（Q5）、搜索（Q6）、薪资档（Q7）、学生端收费（Q10，只预留）
  quotaEnabled: boolean; baseJobViews: number; tierSize: number; tierBonus: number; unlimitedAt: number; referralMinCompleteness: number
  applyMinCompleteness: number; signupCap: number; signupWarnRatio: number
  searchDefaultMode: SearchMode; relatedFallbackBelow: number; salaryBands: number[]; studentBillingEnabled: boolean
}
export interface ViewGrant { id: string; source: 'PURCHASE' | 'ADMIN_GRANT'; amount: number; note: string; at: string }
export type JobReportReason = 'ASKS_PAYMENT' | 'FAKE_SALARY' | 'ILLEGAL_WORK' | 'MISMATCH' | 'OTHER'
export const REPORT_REASON_LABEL: Record<JobReportReason, string> = {
  ASKS_PAYMENT: '要求先交钱', FAKE_SALARY: '虚假或夸大薪资', ILLEGAL_WORK: '疑似非法工作', MISMATCH: '信息与实际不符', OTHER: '其他',
}
export interface JobReport { id: string; jobId: string; reason: JobReportReason; note: string; status: 'OPEN' | 'RESOLVED' | 'DISMISSED'; at: string }
export interface Order { id: string; orderNo: string; name: string; amount: number; credits: number; method: string; at: string }

export interface AppState {
  role: Role
  me: Student
  jobs: Job[]
  applications: Application[]
  invitations: Invitation[]
  unlocks: Unlock[]
  credits: number
  ledger: LedgerEntry[]
  orders: Order[]
  savedJobs: string[]
  talentFavorites: string[]
  blockedCompanies: string[]
  viewsOfMe: CompanyRecord[]
  unlocksOfMe: CompanyRecord[]
  notices: Notice[]
  companyReviews: CompanyReview[]
  partners: Partner[]
  settings: Settings
  audit: AuditEntry[]
  viewedJobs: string[]
  referrals: Referral[]
  viewGrants: ViewGrant[]
  jobReports: JobReport[]
  /** 演示里新注册的学生数，用来展示注册上限进度 */
  demoSignups: number
}

const FLOW: AppStatus[] = ['APPLIED', 'VIEWED', 'SHORTLISTED', 'INTERVIEW', 'OFFER', 'HIRED']
function mkApp(id: string, jobId: string, studentId: string, status: AppStatus, days: number): Application {
  const idx = FLOW.indexOf(status)
  const steps: AppStatus[] = idx >= 0 ? FLOW.slice(0, idx + 1) : ['APPLIED', status]
  return { id, jobId, studentId, status, createdAt: daysAgo(days), events: steps.map((s, i) => ({ status: s, at: daysAgo(Math.max(0, days - i)) })) }
}

function seed(): AppState {
  const notice = (to: NoticeTo, text: string, days: number, read: boolean, link?: string): Notice => ({ id: uid(), to, text, at: daysAgo(days), read, link })
  return {
    role: 'guest',
    me: structuredClone(STUDENTS.find((s) => s.id === ME_ID)!),
    jobs: structuredClone(JOBS),
    applications: [
      mkApp('a1', 'j7', ME_ID, 'INTERVIEW', 6),
      mkApp('a2', 'j17', ME_ID, 'VIEWED', 3),
      mkApp('a3', 'j11', ME_ID, 'REJECTED', 12),
      mkApp('a4', 'j1', 's5', 'APPLIED', 1),
      mkApp('a5', 'j1', 's16', 'VIEWED', 2),
      mkApp('a6', 'j2', 's17', 'SHORTLISTED', 4),
      mkApp('a7', 'j2', 's6', 'INTERVIEW', 7),
      mkApp('a8', 'j3', 's14', 'APPLIED', 0),
      mkApp('a9', 'j3', 's3', 'VIEWED', 2),
    ],
    invitations: [
      { id: 'i1', companyId: 'c1', jobId: 'j1', studentId: ME_ID, message: '你好，看到你在校园二手平台项目里做的前端优化，和我们的岗位很匹配，欢迎投递！', status: 'SENT', createdAt: daysAgo(1) },
      { id: 'i2', companyId: 'c3', jobId: 'j8', studentId: ME_ID, message: '我们在招新媒体运营，你有兴趣了解一下吗？', status: 'EXPIRED', createdAt: daysAgo(20) },
      { id: 'i3', companyId: 'c1', jobId: 'j3', studentId: 's13', message: '你的电商运营经历很适合我们的产品岗位，欢迎投递。', status: 'SENT', createdAt: daysAgo(2) },
    ],
    unlocks: [
      ...['s5', 's16', 's17', 's6', 's14', 's3'].map((id, i) => ({ studentId: id, source: 'APPLICATION' as const, at: daysAgo(i + 1), by: '系统' })),
      { studentId: 's10', source: 'CREDIT', at: daysAgo(8), by: HR_NAME },
      { studentId: 's15', source: 'CREDIT', at: daysAgo(5), by: HR_NAME },
    ],
    credits: 28,
    ledger: [
      { id: 'l3', delta: -1, balanceAfter: 28, reason: 'UNLOCK', note: '解锁人才 Lim Jia Hui', at: daysAgo(5) },
      { id: 'l2', delta: -1, balanceAfter: 29, reason: 'UNLOCK', note: '解锁人才 刘可欣', at: daysAgo(8) },
      { id: 'l1', delta: 30, balanceAfter: 30, reason: 'PILOT_GRANT', note: '公益期 10 月额度（补足至 30 点）', at: daysAgo(29) },
    ],
    orders: [],
    savedJobs: ['j2', 'j18'],
    talentFavorites: ['s5', 's7'],
    blockedCompanies: [],
    viewsOfMe: [
      { companyId: 'c3', at: daysAgo(6) },
      { companyId: 'c8', at: daysAgo(3) },
      { companyId: 'c1', at: daysAgo(1) },
      { companyId: 'c5', at: daysAgo(12) },
    ],
    unlocksOfMe: [
      { companyId: 'c3', at: daysAgo(6), source: 'APPLICATION' },
      { companyId: 'c8', at: daysAgo(3), source: 'APPLICATION' },
      { companyId: 'c5', at: daysAgo(12), source: 'APPLICATION' },
    ],
    notices: [
      notice('student', '星港电商邀请你参加面试：跨境电商运营实习生', 2, false, '/s/applications'),
      notice('student', '鹭江科技邀请你投递「前端开发实习生」', 1, false, '/s/invitations'),
      notice('student', '云帆数据查看了你的投递', 3, true, '/s/applications'),
      notice('employer', '新投递：周子涵 投递了「产品经理助理」', 0, false, '/e/applicants?job=j3'),
      notice('employer', '新投递：黄子轩 投递了「前端开发实习生」', 1, false, '/e/applicants?job=j1'),
      notice('employer', '公益期 10 月额度已到账：30 点', 29, true, '/e/billing'),
      notice('admin', '新的企业认证申请：蓝海支付科技（马来西亚）有限公司', 1, false, '/admin/companies'),
      notice('admin', '新职位待审核：星港电商「直播运营实习生」', 0, false, '/admin/jobs'),
    ],
    companyReviews: [
      { id: 'r1', name: '蓝海支付科技（马来西亚）有限公司', ssm: '202401045678 (1534567-A)', industry: '金融科技', contact: 'Jason Lee · 人事经理', submittedAt: daysAgo(1), files: ['SSM_注册证书.pdf', '公司授权书.jpg'], status: 'PENDING' },
      { id: 'r2', name: '马华食品集团', ssm: '202001023456 (1356789-B)', industry: '食品/快消', contact: '黄小姐 · HR', submittedAt: daysAgo(2), files: ['SSM_注册证书.pdf'], status: 'PENDING' },
      { id: 'r3', name: '启航留学服务中心', ssm: '201901011111 (1312345-C)', industry: '教育咨询', contact: '林先生 · 负责人', submittedAt: daysAgo(3), files: ['SSM_注册证书.pdf', '营业执照.png'], status: 'PENDING' },
      { id: 'r4', name: '南洋建工集团马来西亚分公司', ssm: COMPANIES[1].ssm, industry: '建筑/基建', contact: '何经理', submittedAt: daysAgo(40), files: ['SSM_注册证书.pdf'], status: 'VERIFIED' },
      { id: 'r5', name: '速达代购工作室', ssm: '202501099999 (1601234-D)', industry: '零售', contact: '王先生', submittedAt: daysAgo(10), files: ['截图.jpg'], status: 'REJECTED', reason: '上传的不是 SSM 注册证书，公司名称无法核实' },
    ],
    partners: structuredClone(PARTNERS),
    settings: defaultSettings(),
    // 已看 18 个，演示时再点 2 个就会碰到额度上限
    viewedJobs: JOBS.filter((j) => j.status === 'PUBLISHED' && !['j1', 'j7', 'j8', 'j11', 'j17'].includes(j.id)).slice(0, 18).map((j) => j.id),
    referrals: [
      { id: 'rf1', inviteeId: 'demo-a', inviteeName: '王小明', completeness: 95, emailVerified: true, status: 'QUALIFIED', createdAt: daysAgo(4) },
      { id: 'rf2', inviteeId: 'demo-b', inviteeName: '李华', completeness: 70, emailVerified: true, status: 'PENDING', createdAt: daysAgo(1) },
    ],
    viewGrants: [],
    jobReports: [],
    demoSignups: 0,
    audit: [
      { id: 'au3', actor: `企业 HR ${HR_NAME}`, action: 'talent.unlock', target: 'Lim Jia Hui（s15）· -1 点', at: daysAgo(5) },
      { id: 'au2', actor: `企业 HR ${HR_NAME}`, action: 'talent.unlock', target: '刘可欣（s10）· -1 点', at: daysAgo(8) },
      { id: 'au1', actor: '运营 admin', action: 'company.verify', target: '南洋建工集团马来西亚分公司', at: daysAgo(40) },
    ],
  }
}

function defaultSettings(): Settings {
  return {
    billingEnabled: false, pilotMonthlyCredits: 30, unlockCost: 1, autoPublishAfter: 3, profileViewsPerDay: 200, unlocksPerDay: 50, invitationQuota: 20,
    quotaEnabled: true, baseJobViews: 20, tierSize: 3, tierBonus: 10, unlimitedAt: 12, referralMinCompleteness: 90,
    applyMinCompleteness: 60, signupCap: 3000, signupWarnRatio: 0.9,
    searchDefaultMode: 'EXACT', relatedFallbackBelow: 5, salaryBands: DEFAULT_SALARY_BANDS, studentBillingEnabled: false,
  }
}

/** 新注册学生的空档案 */
function blankStudent(): Student {
  return {
    id: ME_ID, fullName: '', schoolId: '', degree: 'BACHELOR', major: '', gradYear: 0, gradMonth: 0, nationality: '',
    workAuth: 'STUDENT_PASS', intents: [], languages: [], skills: [], headline: '', summary: '', experiences: [], education: [],
    states: [], availableFrom: '', expectedSalary: '', lastActive: now(), hasResume: false,
    contact: { phone: '', email: '', whatsapp: '', wechat: '' }, visibility: 'HIDDEN',
  }
}

// ---------- 纯函数：读取 ----------
export const allStudents = (s: AppState) => [s.me, ...STUDENTS.filter((x) => x.id !== ME_ID)]
export const getStudent = (s: AppState, id: string) => allStudents(s).find((x) => x.id === id)
const blockedMe = (s: AppState, id: string) => id === ME_ID && s.blockedCompanies.includes(MY_COMPANY_ID)
/** 人才库：公开 + 完成度达标 + 没有屏蔽本企业（PRD §0） */
export const talentPool = (s: AppState) =>
  allStudents(s).filter((x) => x.visibility === 'PUBLIC' && completeness(x).score >= MIN_COMPLETENESS && !blockedMe(s, x.id))
export const hasAccess = (s: AppState, id: string) => s.unlocks.some((u) => u.studentId === id) && !blockedMe(s, id)
export const myApplication = (s: AppState, jobId: string) =>
  s.applications.find((a) => a.jobId === jobId && a.studentId === ME_ID && a.status !== 'WITHDRAWN')
export const companyJobs = (s: AppState) => s.jobs.filter((j) => j.companyId === MY_COMPANY_ID)
export const companyApplications = (s: AppState) => {
  const ids = new Set(companyJobs(s).map((j) => j.id))
  return s.applications.filter((a) => ids.has(a.jobId) && a.status !== 'WITHDRAWN')
}
export const quotaSettings = (st: Settings): QuotaSettings => ({
  enabled: st.quotaEnabled, baseJobViews: st.baseJobViews, tierSize: st.tierSize, tierBonus: st.tierBonus,
  unlimitedAt: st.unlimitedAt, referralMinCompleteness: st.referralMinCompleteness,
})
/** 学生"我"的查看额度：limit 为 null 表示不限 */
export function myQuota(s: AppState) {
  const qs = quotaSettings(s.settings)
  const qualified = qualifiedCount(s.referrals, qs)
  const grants = s.viewGrants.reduce((a, g) => a + g.amount, 0)
  return { qualified, grants, limit: viewLimit(qualified, grants, qs), used: s.viewedJobs.length, next: nextTier(qualified, qs) }
}
const appliedJobIds = (s: AppState) => s.applications.filter((a) => a.studentId === ME_ID).map((a) => a.jobId)
const invitedJobIds = (s: AppState) => s.invitations.filter((i) => i.studentId === ME_ID).map((i) => i.jobId)
const isQuotaExempt = (s: AppState, jobId: string) => appliedJobIds(s).includes(jobId) || invitedJobIds(s).includes(jobId)
const canOpenJob = (s: AppState, jobId: string) => canViewJob({
  jobId, viewed: s.viewedJobs, limit: myQuota(s).limit, appliedJobIds: appliedJobIds(s), invitedJobIds: invitedJobIds(s),
})
/** 职位详情能不能看：访客要登录，学生受额度限制，企业和运营不限 */
export function jobAccess(s: AppState, jobId: string): 'open' | 'login' | 'locked' {
  if (!s.settings.quotaEnabled || s.role === 'employer' || s.role === 'admin') return 'open'
  if (s.role === 'guest') return 'login'
  return canOpenJob(s, jobId) ? 'open' : 'locked'
}
export const studentCount = (s: AppState) => STUDENTS.length + s.demoSignups

export const invitesThisMonth = (s: AppState) => {
  const m = new Date().getMonth()
  return s.invitations.filter((i) => i.companyId === MY_COMPANY_ID && new Date(i.createdAt).getMonth() === m).length
}

// ---------- 纯函数：写入 ----------
const pushNotice = (s: AppState, to: NoticeTo, text: string, link?: string): AppState =>
  ({ ...s, notices: [{ id: uid(), to, text, link, at: now(), read: false }, ...s.notices] })
const pushAudit = (s: AppState, actor: string, action: string, target: string): AppState =>
  ({ ...s, audit: [{ id: uid(), actor, action, target, at: now() }, ...s.audit] })

function applyTo(s: AppState, jobId: string, note: string): AppState {
  const job = s.jobs.find((j) => j.id === jobId)
  if (!job || myApplication(s, jobId)) return s
  const app: Application = { id: uid(), jobId, studentId: ME_ID, status: 'APPLIED', createdAt: now(), note, events: [{ status: 'APPLIED', at: now() }] }
  let n: AppState = {
    ...s,
    applications: [app, ...s.applications.filter((a) => !(a.jobId === jobId && a.studentId === ME_ID))],
    unlocksOfMe: [{ companyId: job.companyId, at: now(), source: 'APPLICATION' }, ...s.unlocksOfMe.filter((u) => u.companyId !== job.companyId)],
  }
  if (job.companyId === MY_COMPANY_ID) {
    if (!n.unlocks.some((u) => u.studentId === ME_ID)) n = { ...n, unlocks: [{ studentId: ME_ID, source: 'APPLICATION', at: now(), by: '系统' }, ...n.unlocks] }
    n = pushNotice(n, 'employer', `新投递：${s.me.fullName} 投递了「${job.title}」`, `/e/applicants?job=${job.id}`)
  }
  return n
}

function createActions(state: AppState, setState: (fn: (s: AppState) => AppState) => void) {
  const set = setState
  return {
    setRole: (role: Role) => set((s) => ({ ...s, role })),
    reset: () => set((s) => ({ ...seed(), role: s.role })),

    // ----- 学生 -----
    updateMe: (patch: Partial<Student>) => set((s) => ({ ...s, me: { ...s.me, ...patch } })),
    setVisibility: (v: 'PUBLIC' | 'HIDDEN') =>
      set((s) => pushAudit({ ...s, me: { ...s.me, visibility: v } }, `学生 ${s.me.fullName}`, 'student.visibility.change', v === 'PUBLIC' ? '加入人才库' : '退出人才库')),
    toggleBlock: (companyId: string) =>
      set((s) => ({ ...s, blockedCompanies: s.blockedCompanies.includes(companyId) ? s.blockedCompanies.filter((x) => x !== companyId) : [...s.blockedCompanies, companyId] })),
    toggleSaveJob: (jobId: string) =>
      set((s) => ({ ...s, savedJobs: s.savedJobs.includes(jobId) ? s.savedJobs.filter((x) => x !== jobId) : [jobId, ...s.savedJobs] })),
    apply: (jobId: string, note: string) => set((s) => applyTo(s, jobId, note)),
    withdraw: (appId: string) =>
      set((s) => ({ ...s, applications: s.applications.map((a) => (a.id === appId ? { ...a, status: 'WITHDRAWN', events: [...a.events, { status: 'WITHDRAWN', at: now() }] } : a)) })),
    respondInvitation: (id: string, accept: boolean) =>
      set((s) => {
        const inv = s.invitations.find((i) => i.id === id)
        if (!inv) return s
        let n: AppState = { ...s, invitations: s.invitations.map((i) => (i.id === id ? { ...i, status: accept ? 'ACCEPTED' : 'DECLINED' } : i)) }
        if (accept) n = applyTo(n, inv.jobId, '（通过企业邀请投递）')
        if (inv.companyId === MY_COMPANY_ID) n = pushNotice(n, 'employer', `${s.me.fullName} ${accept ? '接受' : '婉拒'}了你的投递邀请`, accept ? `/e/applicants?job=${inv.jobId}` : undefined)
        return n
      }),
    exportData: () => set((s) => pushAudit(s, `学生 ${s.me.fullName}`, 'data.export', '申请导出个人数据')),
    /** 学生主动打开职位详情时调用；重复打开不重复计数 */
    viewJob: (jobId: string): boolean => {
      const ok = jobAccess(state, jobId) === 'open'
      if (ok && state.role === 'student') set((s) => ({ ...s, viewedJobs: recordJobView(s.viewedJobs, jobId, canOpenJob(s, jobId), isQuotaExempt(s, jobId)) }))
      return ok
    },
    /** 演示用：模拟一位好友通过邀请链接注册，完成度到 completeness */
    simulateReferral: (completeness: number) =>
      set((s) => {
        const names = ['陈思琪', '刘子豪', '张雨桐', '黄俊熙', '林佳怡', '周博文', '吴欣妍', '郑浩宇']
        const name = names[s.referrals.length % names.length]
        const qualified = completeness >= s.settings.referralMinCompleteness
        const r: Referral = { id: uid(), inviteeId: uid(), inviteeName: name, completeness, emailVerified: true, status: qualified ? 'QUALIFIED' : 'PENDING', createdAt: now() }
        const n: AppState = { ...s, referrals: [r, ...s.referrals], demoSignups: s.demoSignups + 1 }
        const text = qualified ? `好友${name}完成了资料，邀请已生效` : `好友${name}已注册，资料完成度到 ${s.settings.referralMinCompleteness}% 后邀请生效`
        return pushNotice(n, 'student', text, '/s/invite')
      }),
    /** 演示用：以一个刚注册的学生身份走完整流程 */
    startFreshStudent: () =>
      set((s) => ({
        ...s, role: 'student', me: blankStudent(), viewedJobs: [], referrals: [], viewGrants: [], savedJobs: [],
        applications: s.applications.filter((a) => a.studentId !== ME_ID),
        invitations: s.invitations.filter((i) => i.studentId !== ME_ID),
        demoSignups: s.demoSignups + 1,
      })),
    reportJob: (jobId: string, reason: JobReportReason, note: string) =>
      set((s) => {
        const job = s.jobs.find((j) => j.id === jobId)
        const n: AppState = { ...s, jobReports: [{ id: uid(), jobId, reason, note, status: 'OPEN', at: now() }, ...s.jobReports] }
        return pushNotice(n, 'admin', `收到职位举报：「${job?.title ?? jobId}」· ${REPORT_REASON_LABEL[reason]}`, '/admin/jobs')
      }),

    // ----- 企业 -----
    viewProfile: (studentId: string) =>
      set((s) => {
        const st = getStudent(s, studentId)
        if (!st) return s
        let n = pushAudit(s, `企业 HR ${HR_NAME}`, 'talent.view', `${hasAccess(s, studentId) ? st.fullName : '匿名档案'}（${studentId}）`)
        if (studentId === ME_ID) n = { ...n, viewsOfMe: [{ companyId: MY_COMPANY_ID, at: now() }, ...n.viewsOfMe.filter((v) => v.companyId !== MY_COMPANY_ID)] }
        return n
      }),
    unlock: (studentId: string): 'ok' | 'already' | 'insufficient' => {
      if (hasAccess(state, studentId)) return 'already'
      const cost = state.settings.unlockCost
      if (state.credits < cost) return 'insufficient'
      set((s) => {
        if (s.unlocks.some((u) => u.studentId === studentId)) return s
        const st = getStudent(s, studentId)!
        const credits = s.credits - cost
        let n: AppState = {
          ...s,
          credits,
          unlocks: [{ studentId, source: 'CREDIT', at: now(), by: HR_NAME }, ...s.unlocks],
          ledger: [{ id: uid(), delta: -cost, balanceAfter: credits, reason: 'UNLOCK', note: `解锁人才 ${st.fullName}`, at: now() }, ...s.ledger],
        }
        n = pushAudit(n, `企业 HR ${HR_NAME}`, 'talent.unlock', `${st.fullName}（${studentId}）· -${cost} 点`)
        if (studentId === ME_ID) {
          n = { ...n, unlocksOfMe: [{ companyId: MY_COMPANY_ID, at: now(), source: 'CREDIT' }, ...n.unlocksOfMe.filter((u) => u.companyId !== MY_COMPANY_ID)] }
          n = pushNotice(n, 'student', '鹭江科技解锁了你的联系方式，可能会通过电话或邮件联系你', '/s/privacy')
        }
        return n
      })
      return 'ok'
    },
    downloadResume: (studentId: string) =>
      set((s) => pushAudit(s, `企业 HR ${HR_NAME}`, 'resume.download', `${getStudent(s, studentId)?.fullName}（${studentId}）· 带水印`)),
    invite: (studentId: string, jobId: string, message: string): 'ok' | 'quota' | 'exists' => {
      if (state.invitations.some((i) => i.companyId === MY_COMPANY_ID && i.studentId === studentId && i.jobId === jobId && i.status === 'SENT')) return 'exists'
      if (invitesThisMonth(state) >= state.settings.invitationQuota) return 'quota'
      set((s) => {
        const job = s.jobs.find((j) => j.id === jobId)!
        let n: AppState = { ...s, invitations: [{ id: uid(), companyId: MY_COMPANY_ID, jobId, studentId, message, status: 'SENT', createdAt: now() }, ...s.invitations] }
        if (studentId === ME_ID) n = pushNotice(n, 'student', `鹭江科技邀请你投递「${job.title}」`, '/s/invitations')
        return n
      })
      return 'ok'
    },
    toggleTalentFavorite: (id: string) =>
      set((s) => ({ ...s, talentFavorites: s.talentFavorites.includes(id) ? s.talentFavorites.filter((x) => x !== id) : [id, ...s.talentFavorites] })),
    moveApplication: (appId: string, status: AppStatus) =>
      set((s) => {
        const app = s.applications.find((a) => a.id === appId)
        if (!app || app.status === status) return s
        let n: AppState = { ...s, applications: s.applications.map((a) => (a.id === appId ? { ...a, status, events: [...a.events, { status, at: now() }] } : a)) }
        if (app.studentId === ME_ID) {
          const job = s.jobs.find((j) => j.id === app.jobId)!
          n = pushNotice(n, 'student', `${companyById(job.companyId).short}更新了你的投递状态：「${job.title}」→ ${APP_STATUS_LABEL[status]}`, '/s/applications')
        }
        return n
      }),
    setInternalNote: (appId: string, note: string) =>
      set((s) => ({ ...s, applications: s.applications.map((a) => (a.id === appId ? { ...a, internalNote: note } : a)) })),
    postJob: (input: Omit<Job, 'id' | 'companyId' | 'status' | 'publishedAt' | 'lat' | 'lng' | 'area'>) => {
      const approved = companyJobs(state).filter((j) => j.status === 'PUBLISHED' || j.status === 'CLOSED').length
      const status = approved >= state.settings.autoPublishAfter ? 'PUBLISHED' : 'PENDING_REVIEW'
      set((s) => {
        const job: Job = { ...input, ...geoOf(input.city), id: `j${uid()}`, companyId: MY_COMPANY_ID, status, publishedAt: now() }
        let n: AppState = { ...s, jobs: [job, ...s.jobs] }
        if (status === 'PENDING_REVIEW') n = pushNotice(n, 'admin', `新职位待审核：鹭江科技「${job.title}」`, '/admin/jobs')
        return n
      })
      return status
    },
    setJobStatus: (jobId: string, status: 'PUBLISHED' | 'CLOSED') =>
      set((s) => ({ ...s, jobs: s.jobs.map((j) => (j.id === jobId ? { ...j, status } : j)) })),
    buyPackage: (name: string, amount: number, credits: number, method: string) =>
      set((s) => {
        const balance = s.credits + credits
        const orderNo = `TB-${formatDate(now()).replace(/-/g, '')}-${Math.floor(1000 + Math.random() * 9000)}`
        let n: AppState = {
          ...s,
          credits: balance,
          ledger: [{ id: uid(), delta: credits, balanceAfter: balance, reason: 'PURCHASE', note: `购买「${name}」· 订单 ${orderNo}`, at: now() }, ...s.ledger],
          orders: [{ id: uid(), orderNo, name, amount, credits, method, at: now() }, ...s.orders],
        }
        n = pushAudit(n, '系统', 'order.confirm', `${orderNo} · 鹭江科技 · RM ${amount}`)
        return pushNotice(n, 'employer', `订单 ${orderNo} 支付成功，已到账 ${credits} 点`, '/e/billing')
      }),

    // ----- 运营 -----
    reviewJob: (jobId: string, approve: boolean, reason?: string) =>
      set((s) => {
        const job = s.jobs.find((j) => j.id === jobId)!
        let n: AppState = { ...s, jobs: s.jobs.map((j) => (j.id === jobId ? { ...j, status: approve ? 'PUBLISHED' : 'REJECTED', publishedAt: now(), reviewNote: reason } : j)) }
        n = pushAudit(n, '运营 admin', 'job.review', `${companyById(job.companyId).short}「${job.title}」· ${approve ? '通过' : `驳回：${reason}`}`)
        if (job.companyId === MY_COMPANY_ID) n = pushNotice(n, 'employer', `职位「${job.title}」${approve ? '已通过审核并发布' : `未通过审核：${reason}`}`, '/e/jobs')
        return n
      }),
    reviewCompany: (id: string, approve: boolean, reason?: string) =>
      set((s) => {
        const r = s.companyReviews.find((x) => x.id === id)!
        const n: AppState = { ...s, companyReviews: s.companyReviews.map((x) => (x.id === id ? { ...x, status: approve ? 'VERIFIED' : 'REJECTED', reason } : x)) }
        return pushAudit(n, '运营 admin', approve ? 'company.verify' : 'company.reject', `${r.name}${reason ? ` · ${reason}` : ''}`)
      }),
    updateSettings: (patch: Partial<Settings>) =>
      set((s) => {
        let n: AppState = { ...s, settings: { ...s.settings, ...patch } }
        for (const [key, value] of Object.entries(patch)) {
          if (s.settings[key as keyof Settings] !== value) n = pushAudit(n, '运营 admin', 'setting.update', `${key}: ${s.settings[key as keyof Settings]} → ${value}`)
        }
        if (patch.billingEnabled !== undefined && patch.billingEnabled !== s.settings.billingEnabled) {
          n = pushNotice(n, 'employer', patch.billingEnabled ? '平台已结束公益期，开始收费。你的现有点数全部保留。' : '平台已恢复公益期，每月自动补足点数。', '/e/billing')
        }
        return n
      }),
    resolveReport: (id: string, status: 'RESOLVED' | 'DISMISSED') =>
      set((s) => {
        const r = s.jobReports.find((x) => x.id === id)
        if (!r) return s
        const job = s.jobs.find((j) => j.id === r.jobId)
        const n: AppState = { ...s, jobReports: s.jobReports.map((x) => (x.id === id ? { ...x, status } : x)) }
        return pushAudit(n, '运营 admin', 'job.report.resolve', `「${job?.title ?? r.jobId}」· ${status === 'RESOLVED' ? '已处理' : '驳回举报'}`)
      }),
    grantViews: (amount: number, note: string) =>
      set((s) => pushAudit({ ...s, viewGrants: [{ id: uid(), source: 'ADMIN_GRANT', amount, note, at: now() }, ...s.viewGrants] }, '运营 admin', 'quota.grant', `${s.me.fullName || '学生'} · +${amount} 个职位 · ${note}`)),
    togglePartner: (id: string) =>
      set((s) => ({ ...s, partners: s.partners.map((p) => (p.id === id ? { ...p, showOnHome: !p.showOnHome } : p)) })),

    markRead: (to: NoticeTo) => set((s) => ({ ...s, notices: s.notices.map((n) => (n.to === to ? { ...n, read: true } : n)) })),
  }
}

type Actions = ReturnType<typeof createActions>
const Ctx = createContext<{ state: AppState; actions: Actions } | null>(null)
const KEY = 'findmyjob-prototype-v2'

export function StoreProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AppState>(() => {
    try {
      const raw = localStorage.getItem(KEY)
      if (raw) {
        const base = seed()
        const saved = JSON.parse(raw) as Partial<AppState>
        return { ...base, ...saved, settings: { ...base.settings, ...saved.settings } }
      }
    } catch {
      /* 读失败就用种子数据 */
    }
    return seed()
  })
  useEffect(() => {
    localStorage.setItem(KEY, JSON.stringify(state))
  }, [state])
  return <Ctx.Provider value={{ state, actions: createActions(state, setState) }}>{children}</Ctx.Provider>
}

export function useStore() {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useStore 必须在 StoreProvider 内使用')
  return ctx
}
