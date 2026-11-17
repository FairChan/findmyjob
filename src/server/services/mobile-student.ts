import 'server-only'
import type { CompanyTag, CompanySize } from '@prisma/client'
import { db } from '../db'
import { ForbiddenError, NotFoundError, AppError } from '../errors'
import type { UserCtx } from '../authz'
import { toIso } from '../lib/mobile-api'
import { toJobListItem, type JobListItem } from '../serializers/job'
import { searchJobs } from './job-search'
import { canApplyToJob, getQuota, type QuotaResult } from './job-view-quota'
import { getDashboardData, getProfileForOnboarding } from './student-profile'
import { listActiveSchools } from './school-verification'
import { getPublicCompany, listPublicCompanies } from './company'
import { listCompanyBrowseJobs } from './company-browse'
import { getStudentApplicationTimeline, listStudentApplications } from './applications'
import { listStudentInvitations } from './invitations'
import { getOrCreateReferralCode } from './referrals'
import { getSetting } from './settings'
import { maskName } from '@/lib/mask-name'
import { safeWebsiteHref } from '@/lib/url-utils'
import type {
  MobileApplicationList,
  MobileApplicationTimeline,
  MobileCompanyDetail,
  MobileCompanyPage,
  MobileInvitationList,
  MobileJobListItem,
  MobileJobPage,
  MobileJobPreview,
  MobileJobsQuery,
  MobileNotificationPage,
  MobileProfile,
  MobileProfileCompleteness,
  MobileQuota,
  MobileReferrals,
  MobileSchoolList,
} from '@/shared/mobile-api'

// /api/m/v1 学生端的读模型（MA1-T04）。这里只做"调现有 service + 序列化成 JSON"，
// 业务规则（可见性、额度、隐藏薪资、备注不给学生）都留在原 service 里，Web 与 App 共用。

const JOB_PAGE_LIMIT = 20
const NOTIFICATION_PAGE_LIMIT = 50

/** Web 职位页和投递页允许撤回的状态；出了结果再撤回只会让双方困惑 */
export const WITHDRAWABLE_STATUSES = ['APPLIED', 'VIEWED', 'SHORTLISTED', 'INTERVIEW'] as const

export async function requireStudentProfileId(ctx: UserCtx): Promise<string> {
  const profile = await db.studentProfile.findUnique({ where: { userId: ctx.userId }, select: { id: true } })
  if (!profile) throw new ForbiddenError('Student profile not found')
  return profile.id
}

export function serializeJobListItem(job: JobListItem): MobileJobListItem {
  return { ...job, deadline: toIso(job.deadline), publishedAt: toIso(job.publishedAt) }
}

export function serializeQuota(q: QuotaResult): MobileQuota {
  return { used: q.used, limit: q.limit, next: q.next, qualified: q.qualified }
}

// ---- 建档 ----

export async function getMobileProfile(ctx: UserCtx): Promise<MobileProfile> {
  const p = await getProfileForOnboarding(ctx)
  if (!p) throw new NotFoundError('Student profile not found')
  return {
    fullName: p.fullName,
    schoolId: p.schoolId,
    degreeLevel: p.degreeLevel,
    major: p.major,
    graduationYear: p.graduationYear,
    graduationMonth: p.graduationMonth,
    cgpa: p.cgpa === null ? null : Number(p.cgpa),
    nationality: p.nationality,
    workAuth: p.workAuth,
    intents: p.intents,
    availableFrom: toIso(p.availableFrom),
    preferredStates: p.preferredStates,
    preferredIndustries: p.preferredIndustries,
    expectedSalaryMin: p.expectedSalaryMin,
    expectedSalaryMax: p.expectedSalaryMax,
    skills: p.skills,
    headline: p.headline,
    summary: p.summary,
    onboardingStep: p.onboardingStep,
    languages: p.languages,
    educations: p.educations.map((e) => ({ ...e, startDate: toIso(e.startDate), endDate: toIso(e.endDate) })),
    experiences: p.experiences.map((e) => ({ ...e, startDate: toIso(e.startDate), endDate: toIso(e.endDate) })),
  }
}

export async function getMobileProfileCompleteness(ctx: UserCtx): Promise<MobileProfileCompleteness> {
  const d = await getDashboardData(ctx)
  if (!d) throw new NotFoundError('Student profile not found')
  return {
    completeness: d.completeness,
    schoolVerified: d.schoolVerifiedAt !== null,
    hasResume: d.hasResume,
    hasContact: d.hasContact,
    talentPoolEnabled: d.talentPoolEnabled,
  }
}

export async function listMobileSchools(): Promise<MobileSchoolList> {
  return { items: await listActiveSchools() }
}

// ---- 职位 ----

/** 与 Web /s/jobs 一样：不搜正文（canSeeDescription=false），列表永远不扣额度 */
export async function listMobileJobs(input: MobileJobsQuery): Promise<MobileJobPage> {
  const tags = input.tags ? (input.tags.split(',') as CompanyTag[]) : undefined
  const result = await searchJobs({
    q: input.q ?? '',
    filters: {
      ...(input.type ? { type: input.type } : {}),
      ...(input.state ? { state: input.state } : {}),
      ...(input.workMode ? { workMode: input.workMode } : {}),
      ...(input.sort ? { sort: input.sort } : {}),
      ...(input.industry ? { industry: input.industry } : {}),
      ...(tags?.length ? { tags } : {}),
      ...(input.size ? { size: input.size as CompanySize } : {}),
      ...(input.salary ? { salaryAtLeast: input.salary } : {}),
    },
    page: { cursor: input.cursor, limit: JOB_PAGE_LIMIT },
    canSeeDescription: false,
  })
  return {
    items: [...result.exact, ...result.related].map((h) => serializeJobListItem(h.job)),
    nextCursor: result.nextCursor,
  }
}

const visibleJobSelect = {
  id: true, title: true, type: true, category: true, workMode: true, state: true, city: true,
  salaryMin: true, salaryMax: true, salaryVisible: true, description: true, requirements: true,
  benefits: true, languages: true, skills: true, acceptsStudentPass: true, sponsorsWorkPass: true,
  headcount: true, deadline: true, publishedAt: true, viewCount: true, status: true, companyId: true,
  company: { select: { id: true, displayNameZh: true, displayNameEn: true, legalName: true, isActive: true } },
} as const

/** 与 Web 职位详情页同一条可见性规则：已发布、未过截止日、企业仍有效；否则一律 404 */
export async function loadVisibleJob(jobId: string) {
  const job = await db.job.findUnique({ where: { id: jobId }, select: visibleJobSelect })
  const now = new Date()
  if (!job || job.status !== 'PUBLISHED' || (job.deadline !== null && job.deadline <= now) || !job.company.isActive) {
    throw new NotFoundError('Job not found')
  }
  const { isActive: _isActive, ...company } = job.company
  void _isActive
  return { ...job, company }
}

/** 只读预览：不建 JobView、不动 viewCount、不扣额度（列表划过去、点开预览都不计数） */
export async function previewMobileJob(ctx: UserCtx, jobId: string): Promise<MobileJobPreview> {
  const studentId = await requireStudentProfileId(ctx)
  const job = await loadVisibleJob(jobId)
  const [application, freeByQuotaRules, quota] = await Promise.all([
    db.application.findUnique({ where: { jobId_studentId: { jobId, studentId } }, select: { id: true } }),
    canApplyToJob(studentId, jobId),
    getQuota(studentId),
  ])
  return {
    job: serializeJobListItem(toJobListItem(job)),
    opensFree: application !== null || freeByQuotaRules,
    quota: serializeQuota(quota),
  }
}

// ---- 企业 ----

export async function listMobileCompanies(input: { tag?: CompanyTag; cursor?: string }): Promise<MobileCompanyPage> {
  const { items, nextCursor } = await listPublicCompanies(input)
  return {
    items: items.map((c) => ({
      id: c.id,
      legalName: c.legalName,
      displayNameZh: c.displayNameZh,
      displayNameEn: c.displayNameEn,
      hasLogo: !!c.logoKey,
      state: c.state,
      city: c.city,
      publishedJobCount: c.publishedJobCount,
    })),
    nextCursor,
  }
}

export async function getMobileCompany(companyId: string, jobsCursor?: string): Promise<MobileCompanyDetail> {
  const c = await getPublicCompany(companyId)
  if (!c) throw new NotFoundError('Company not found')
  const jobs = await listCompanyBrowseJobs(c.id, jobsCursor)
  return {
    company: {
      id: c.id,
      legalName: c.legalName,
      displayNameZh: c.displayNameZh,
      displayNameEn: c.displayNameEn,
      description: c.description,
      website: safeWebsiteHref(c.website),
      hasLogo: !!c.logoKey,
      state: c.state,
      city: c.city,
      industryCode: c.industryCode,
      size: c.size,
      isFoundingPartner: c.isFoundingPartner,
    },
    jobs,
  }
}

// ---- 通知 ----

export async function listMobileNotifications(ctx: UserCtx, cursor?: string): Promise<MobileNotificationPage> {
  if (cursor) {
    // 游标必须是自己的通知，否则别人的通知时间点会被拿来翻页
    const own = await db.notification.findFirst({ where: { id: cursor, userId: ctx.userId }, select: { id: true } })
    if (!own) throw new AppError('Invalid cursor', 'VALIDATION_ERROR', 400)
  }
  const [rows, unreadCount] = await Promise.all([
    db.notification.findMany({
      where: { userId: ctx.userId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: NOTIFICATION_PAGE_LIMIT + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: { id: true, type: true, readAt: true, createdAt: true },
    }),
    db.notification.count({ where: { userId: ctx.userId, readAt: null } }),
  ])
  const hasMore = rows.length > NOTIFICATION_PAGE_LIMIT
  const page = hasMore ? rows.slice(0, NOTIFICATION_PAGE_LIMIT) : rows
  return {
    items: page.map((n) => ({ id: n.id, type: n.type, readAt: toIso(n.readAt), createdAt: n.createdAt.toISOString() })),
    nextCursor: hasMore ? (page[page.length - 1]?.id ?? null) : null,
    unreadCount,
  }
}

// ---- 投递 ----

/** Web 投递页一次列出全部投递（没有分页），App 保持同样的数据量；nextCursor 恒为 null，留给以后分页 */
export async function listMobileApplications(ctx: UserCtx): Promise<MobileApplicationList> {
  const rows = await listStudentApplications(ctx)
  return {
    items: rows.map((a) => ({
      id: a.id,
      status: a.status,
      coverNote: a.coverNote,
      createdAt: a.createdAt.toISOString(),
      canWithdraw: (WITHDRAWABLE_STATUSES as readonly string[]).includes(a.status),
      job: a.job,
    })),
    nextCursor: null,
  }
}

export async function getMobileApplicationTimeline(ctx: UserCtx, applicationId: string): Promise<MobileApplicationTimeline> {
  const events = await getStudentApplicationTimeline(ctx, applicationId)
  return {
    events: events.map((e) => ({ id: e.id, fromStatus: e.fromStatus, toStatus: e.toStatus, createdAt: e.createdAt.toISOString() })),
  }
}

// ---- 企业邀请 ----

export async function listMobileInvitations(ctx: UserCtx): Promise<MobileInvitationList> {
  const rows = await listStudentInvitations(ctx)
  return {
    items: rows.map((inv) => ({
      id: inv.id,
      status: inv.status,
      message: inv.message,
      expiresAt: inv.expiresAt.toISOString(),
      createdAt: inv.createdAt.toISOString(),
      respondedAt: toIso(inv.respondedAt),
      applicationId: inv.applicationId,
      // listStudentInvitations 已按 salaryVisible 把薪资置空；salaryVisible 本身不下发
      job: inv.job
        ? {
            id: inv.job.id, title: inv.job.title, type: inv.job.type, workMode: inv.job.workMode,
            city: inv.job.city, salaryMin: inv.job.salaryMin, salaryMax: inv.job.salaryMax,
          }
        : null,
      company: inv.company,
    })),
    nextCursor: null,
  }
}

// ---- 邀请同学 ----

/** 与 Web /s/invite 同源：额度、邀请码、阶梯设置，被邀请人只给打码名和完成度 */
export async function getMobileReferrals(ctx: UserCtx): Promise<MobileReferrals> {
  const studentId = await requireStudentProfileId(ctx)
  const [quota, code, tierSize, unlimitedAt, tierBonus, user, referrals] = await Promise.all([
    getQuota(studentId),
    getOrCreateReferralCode(studentId),
    getSetting<number>('studentQuota.tierSize', 3),
    getSetting<number>('studentQuota.unlimitedAt', 12),
    getSetting<number>('studentQuota.tierBonus', 10),
    db.user.findUnique({ where: { id: ctx.userId }, select: { locale: true } }),
    db.referral.findMany({
      where: { referrerId: studentId },
      orderBy: { createdAt: 'desc' },
      select: { id: true, status: true, invitee: { select: { fullName: true, completeness: true } } },
    }),
  ])
  // Web 用请求的 Host 拼链接；App 请求没有可信的站点 Host，改用配置的 APP_URL
  const base = (process.env.APP_URL ?? '').replace(/\/$/, '')
  const locale = user?.locale === 'en' ? 'en' : 'zh'
  return {
    code,
    inviteLink: `${base}/${locale}/register/student?ref=${encodeURIComponent(code)}`,
    quota: serializeQuota(quota),
    tierSize,
    tierBonus,
    unlimitedAt,
    referrals: referrals.map((r) => ({
      id: r.id,
      status: r.status,
      inviteeName: r.invitee?.fullName ? maskName(r.invitee.fullName) : null,
      inviteeCompleteness: r.invitee ? r.invitee.completeness : null,
    })),
  }
}
