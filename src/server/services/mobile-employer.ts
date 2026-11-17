import 'server-only'
import { ApplicationStatus, type DegreeLevel, type JobType, type WorkAuth } from '@prisma/client'
import { db } from '../db'
import { assertCompanyVerified, type CompanyCtx } from '../authz'
import { NotFoundError } from '../errors'
import { toIso } from '../lib/mobile-api'
import { toEmployerCoverNote, type TalentCard, type TalentDetail } from '../serializers/talent-card'
import { closeJob, listCompanyJobs } from './jobs'
import { listJobApplicants } from './applicants'
import { getMonthlyInvitationUsage, listCompanyInvitations } from './invitations'
import { searchTalents } from './talent-search'
import { viewTalentProfile } from './talent-view'
import { getValidatedUnlockSettings, unlockStudent } from './unlock'
import { getBalance } from './credits'
import { getSetting } from './settings'
import type {
  MobileApplicantDetail,
  MobileApplicantList,
  MobileCompanyInvitationList,
  MobileEmployerJobList,
  MobileTalentCard,
  MobileTalentDetail,
  MobileTalentPage,
  MobileTalentQuery,
  MobileTalentView,
} from '@/shared/mobile-api'

// /api/m/v1/e/* 企业端的读写模型（MA4-T01）。这里只调 Web 企业端用的同一批 service，再把结果转成 JSON：
// 学生数据一律是 talent-card 序列化器（toTalentCard / toTalentDetail）的输出，这里只改日期格式、
// 去掉 resumePreview 这类兼容字段，不新增任何学生字段。companyId 只来自 route() 的 requireCompanyMember。

export function serializeTalentCard(card: TalentCard): MobileTalentCard {
  return { ...card, lastActiveAt: toIso(card.lastActiveAt) }
}

export function serializeTalentDetail(d: TalentDetail): MobileTalentDetail {
  const { resumePreview: _resumePreview, ...rest } = d
  void _resumePreview
  return {
    ...rest,
    lastActiveAt: toIso(d.lastActiveAt),
    educations: d.educations.map((e) => ({ ...e, startDate: toIso(e.startDate), endDate: toIso(e.endDate) })),
    experiences: d.experiences.map((e) => ({ ...e, startDate: toIso(e.startDate), endDate: toIso(e.endDate) })),
  }
}

// ---- 职位 ----

export async function listMobileEmployerJobs(ctx: CompanyCtx): Promise<MobileEmployerJobList> {
  const jobs = await listCompanyJobs(ctx)
  return {
    items: jobs.map(({ _count, ...j }) => ({
      ...j,
      publishedAt: toIso(j.publishedAt),
      closedAt: toIso(j.closedAt),
      deadline: toIso(j.deadline),
      createdAt: j.createdAt.toISOString(),
      applicationCount: _count.applications,
    })),
  }
}

/** Web 职位列表只有"关闭"（没有暂停/恢复）；重新上架要在 Web 编辑后重新提交审核 */
export async function closeMobileEmployerJob(ctx: CompanyCtx, jobId: string) {
  const job = await closeJob(ctx, jobId)
  return { id: job.id, status: job.status }
}

// ---- 候选人 ----

export async function listMobileApplicants(ctx: CompanyCtx, jobId: string): Promise<MobileApplicantList> {
  const { applicants, jobTitle } = await listJobApplicants(ctx, jobId)
  return {
    jobTitle,
    items: applicants.map((a) => ({
      applicationId: a.applicationId,
      status: a.status,
      coverNote: a.coverNote,
      companyNote: a.companyNote,
      createdAt: a.createdAt.toISOString(),
      updatedAt: a.updatedAt.toISOString(),
      card: serializeTalentCard(a.card),
      graduationMonth: a.graduationMonth,
      languages: a.languages,
      internshipCount: a.internshipCount,
      campusCount: a.campusCount,
    })),
  }
}

/**
 * 候选人详情，与 Web 看板点开候选人的路径一致：看板只列出非 WITHDRAWN 的投递，点开后进 /e/talent/:studentId，
 * 也就是 viewTalentProfile。所以这里先按看板的规则找投递（本公司、非 WITHDRAWN，否则 404），
 * 再调同一个 viewTalentProfile：可见性和屏蔽检查、ProfileView 与每日查看上限（D18）、talent.view 审计、
 * 解锁后经 contact-access 读联系方式，全部与 Web 相同。会计数，App 只能在用户点击时调用。
 * 求职信按看板的方式处理（toEmployerCoverNote，未解锁时 redact 并去掉姓名）。
 */
export async function getMobileApplicant(ctx: CompanyCtx, applicationId: string): Promise<MobileApplicantDetail> {
  await assertCompanyVerified(ctx.companyId)
  const app = await db.application.findUnique({
    where: { id: applicationId },
    select: {
      id: true, status: true, coverNote: true, companyNote: true, createdAt: true, studentId: true,
      job: { select: { companyId: true } },
      student: { select: { fullName: true } },
    },
  })
  if (!app || app.job.companyId !== ctx.companyId || app.status === ApplicationStatus.WITHDRAWN) {
    throw new NotFoundError('Application not found')
  }
  const profile = await viewTalentProfile(ctx, app.studentId)
  return {
    applicationId: app.id,
    studentId: app.studentId,
    status: app.status,
    coverNote: toEmployerCoverNote(app.coverNote, app.student.fullName, profile.unlocked),
    companyNote: app.companyNote,
    createdAt: app.createdAt.toISOString(),
    profile: serializeTalentDetail(profile),
  }
}

// ---- 邀请 ----

export async function listMobileCompanyInvitations(ctx: CompanyCtx): Promise<MobileCompanyInvitationList> {
  const [rows, usage] = await Promise.all([listCompanyInvitations(ctx), getMonthlyInvitationUsage(ctx.companyId)])
  return {
    usage,
    items: rows.map((inv) => ({
      id: inv.id,
      status: inv.status,
      message: inv.message,
      expiresAt: inv.expiresAt.toISOString(),
      createdAt: inv.createdAt.toISOString(),
      respondedAt: toIso(inv.respondedAt),
      applicationId: inv.applicationId,
      job: inv.job,
      student: serializeTalentCard(inv.student),
    })),
  }
}

// ---- 人才库 ----

/**
 * 与 Web /e/talent 同一个 searchTalents：页数上限（talentSearch.maxPage）、每人每天翻页数
 * （limits.searchPagesPerDay）和 TM-002 关键词 redact 都在里面。游标就是页码，App 不能跳页超过上限。
 */
export async function searchMobileTalent(ctx: CompanyCtx, q: MobileTalentQuery): Promise<MobileTalentPage> {
  const page = q.cursor ? Number(q.cursor) : 1
  const result = await searchTalents(ctx, {
    page,
    keyword: q.keyword,
    sort: q.sort ?? 'lastActive',
    schoolId: q.schoolId,
    degreeLevel: q.degreeLevel as DegreeLevel | undefined,
    graduationYearFrom: q.gradFrom,
    graduationYearTo: q.gradTo,
    intents: q.intents ? (q.intents.split(',') as JobType[]) : undefined,
    workAuths: q.workAuths ? (q.workAuths.split(',') as WorkAuth[]) : undefined,
  })
  const lastPage = Math.min(result.maxPage, Math.ceil(result.total / result.pageSize))
  return {
    items: result.students.map(serializeTalentCard),
    total: result.total,
    nextCursor: result.page < lastPage ? String(result.page + 1) : null,
    maxPage: result.maxPage,
  }
}

/**
 * 查看学生详情：与 Web 详情页同一个 viewTalentProfile——写 ProfileView、按成员和公司计每日查看上限、
 * 写 talent.view 审计；解锁后联系方式经 contact-access 读出（写 contact.read 审计）。会计数，App 只能在用户点击时调用。
 */
export async function viewMobileTalent(ctx: CompanyCtx, studentId: string): Promise<MobileTalentView> {
  const [detail, settings, enabled] = await Promise.all([
    viewTalentProfile(ctx, studentId),
    getValidatedUnlockSettings(),
    getSetting<boolean>('unlock.enabled', true),
  ])
  return { detail: serializeTalentDetail(detail), unlock: { enabled: enabled === true, costCredits: settings.costCredits } }
}

/** 解锁：unlockStudent 在 CREDIT 锁的事务里经 applyLedgerEntry 扣点，已解锁过的再调不重复扣（幂等） */
export async function unlockMobileTalent(ctx: CompanyCtx, studentId: string) {
  const result = await unlockStudent(ctx, studentId)
  return { ...result, balance: await getBalance(ctx) }
}

/** 余额只读；企业未认证时为 null，与 Web 工作台一致 */
export async function getMobileWallet(ctx: CompanyCtx): Promise<{ balance: number | null }> {
  const company = await db.company.findUnique({ where: { id: ctx.companyId }, select: { verificationStatus: true } })
  return { balance: company?.verificationStatus === 'VERIFIED' ? await getBalance(ctx) : null }
}
