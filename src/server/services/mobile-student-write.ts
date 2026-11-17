import 'server-only'
import { db } from '../db'
import { NotFoundError } from '../errors'
import type { UserCtx } from '../authz'
import { logger } from '../lib/logger'
import { toJobDetail, toJobListItem } from '../serializers/job'
import { openJob } from './job-view-quota'
import { getSetting } from './settings'
import { hasStudentContact } from './contact-access'
import {
  getLatestTalentPoolConsent,
  getProfileViews,
  getUnlocks,
  listBlockedCompanies,
} from './privacy'
import { getMarketingUiState } from './marketing-consent'
import {
  WITHDRAWABLE_STATUSES,
  loadVisibleJob,
  requireStudentProfileId,
  serializeJobListItem,
  serializeQuota,
} from './mobile-student'
import { getApplicationBlocker } from '@/lib/application-readiness'
import { toIso } from '../lib/mobile-api'
import type { MobileJobOpen, MobileNotificationPrefs, MobilePrivacy } from '@/shared/mobile-api'

// /api/m/v1 学生端写端点里需要额外组装数据的部分（MA1-T05）。
// 纯写操作（建档、投递、撤回、邀请、隐私、导出、注销）在 route 里直接调原 service，不经过这里。

/**
 * 打开职位详情：App 里唯一会扣额度的调用，规则与 Web 职位详情页（components/jobs/job-detail-page.tsx）一致——
 * 额度判断和扣减只经 job-view-quota 的 openJob（投过、被邀请过的职位不扣；同一职位重复打开不重复扣），
 * 首次打开才给 viewCount 加一；额度用完时只返回列表级字段（对应 Web 的锁定卡片）。
 */
export async function openMobileJob(ctx: UserCtx, jobId: string): Promise<MobileJobOpen> {
  const studentId = await requireStudentProfileId(ctx)
  const job = await loadVisibleJob(jobId)
  const { allowed, isNewView, quota } = await openJob(studentId, jobId)
  const listItem = serializeJobListItem(toJobListItem(job))

  if (!allowed) {
    return { allowed: false, quota: serializeQuota(quota), job: listItem, detail: null, application: null, applyBlocker: null, resumes: [] }
  }

  if (isNewView) {
    // 与 Web 一样只在首次打开时计数；计数失败不影响学生看详情
    await db.job.update({ where: { id: jobId }, data: { viewCount: { increment: 1 } } }).catch((err) => {
      logger.warn({ jobId, err: err instanceof Error ? err.message : String(err) }, 'Job viewCount increment failed')
    })
  }

  const [profile, minCompleteness, existing] = await Promise.all([
    db.studentProfile.findUniqueOrThrow({
      where: { id: studentId },
      select: {
        completeness: true,
        resumes: { select: { id: true, fileName: true, isPrimary: true }, orderBy: [{ isPrimary: 'desc' }, { createdAt: 'desc' }] },
      },
    }),
    getSetting<number>('apply.minCompleteness', 60),
    db.application.findUnique({ where: { jobId_studentId: { jobId, studentId } }, select: { id: true, status: true } }),
  ])
  const applyBlocker = getApplicationBlocker(
    { hasContact: await hasStudentContact(studentId), hasResume: profile.resumes.length > 0, completeness: profile.completeness },
    minCompleteness,
  )
  // viewCount 是企业侧的统计，Web 详情页不展示给学生，这里也不下发
  const { viewCount: _viewCount, ...detail } = toJobDetail(job)
  void _viewCount

  return {
    allowed: true,
    quota: serializeQuota(quota),
    job: listItem,
    detail: { ...detail, deadline: toIso(detail.deadline), publishedAt: toIso(detail.publishedAt) },
    application: existing
      ? { id: existing.id, status: existing.status, canWithdraw: (WITHDRAWABLE_STATUSES as readonly string[]).includes(existing.status) }
      : null,
    applyBlocker,
    resumes: profile.resumes,
  }
}

/** 隐私中心，数据来源与 Web /s/privacy 相同 */
export async function getMobilePrivacy(ctx: UserCtx): Promise<MobilePrivacy> {
  const [consent, blocked, views, unlocks] = await Promise.all([
    getLatestTalentPoolConsent(ctx.userId),
    listBlockedCompanies(ctx),
    getProfileViews(ctx),
    getUnlocks(ctx),
  ])
  return {
    talentPoolVisible: consent === true,
    blockedCompanies: blocked.map((b) => ({ companyId: b.companyId, companyName: b.companyName, blockedAt: b.createdAt.toISOString() })),
    profileViews: views.map((v) => ({ companyId: v.companyId, companyName: v.companyName, viewedAt: v.viewedAt.toISOString() })),
    unlocks: unlocks.map((u) => ({ companyId: u.companyId, companyName: u.companyName, unlockedAt: u.unlockedAt.toISOString(), source: u.source })),
  }
}

export async function getMobileNotificationPrefs(ctx: UserCtx): Promise<MobileNotificationPrefs> {
  const s = await getMarketingUiState(ctx)
  return { weeklyDigest: { available: s.available, granted: s.consentGranted }, legalVersion: s.legalVersion }
}

/** 与 Web 的 updateLocaleAction 相同：只改自己的 locale */
export async function setMobileLocale(ctx: UserCtx, locale: 'zh' | 'en'): Promise<{ locale: 'zh' | 'en' }> {
  const updated = await db.user.updateMany({ where: { id: ctx.userId }, data: { locale } })
  if (updated.count === 0) throw new NotFoundError('User not found')
  return { locale }
}
