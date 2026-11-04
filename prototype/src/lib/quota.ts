import type { Job } from '../data/mock'

// 学生查看额度与邀请解锁（PRD v0.2 §2.5，DECISIONS Q1–Q3）。正式版对应 job-view-quota.ts 和 referrals.ts
export interface QuotaSettings {
  enabled: boolean; baseJobViews: number; tierSize: number; tierBonus: number; unlimitedAt: number; referralMinCompleteness: number
}
export interface Referral {
  id: string; inviteeId: string; inviteeName: string; completeness: number; emailVerified: boolean
  status: 'PENDING' | 'QUALIFIED' | 'VOID'; createdAt: string
}

/** 有效邀请数：没作废、邮箱已验证、完成度达标；同一被邀请人只算一次 */
export function qualifiedCount(refs: Referral[], s: QuotaSettings): number {
  return new Set(refs.filter((r) => r.status !== 'VOID' && r.emailVerified && r.completeness >= s.referralMinCompleteness).map((r) => r.inviteeId)).size
}

/** 能看几个职位详情；null 表示不限 */
export function viewLimit(qualified: number, grants: number, s: QuotaSettings): number | null {
  if (!s.enabled || qualified >= s.unlimitedAt) return null
  return s.baseJobViews + Math.floor(qualified / s.tierSize) * s.tierBonus + grants
}

/** 再邀请几个人能到下一档；已经不限时返回 null */
export function nextTier(qualified: number, s: QuotaSettings): { need: number; bonus: number | 'UNLIMITED' } | null {
  if (!s.enabled || qualified >= s.unlimitedAt) return null
  const next = Math.min((Math.floor(qualified / s.tierSize) + 1) * s.tierSize, s.unlimitedAt)
  return { need: next - qualified, bonus: next >= s.unlimitedAt ? 'UNLIMITED' : s.tierBonus }
}

/** 已投递、被企业邀请、看过的职位总能打开；其他职位看额度 */
export function canViewJob(a: { jobId: string; viewed: string[]; appliedJobIds: string[]; invitedJobIds: string[]; limit: number | null }): boolean {
  if (a.limit === null) return true
  if (a.appliedJobIds.includes(a.jobId) || a.invitedJobIds.includes(a.jobId) || a.viewed.includes(a.jobId)) return true
  return a.viewed.length < a.limit
}

/** 记一次查看；重复打开同一职位不再计数，不允许时原样返回。已投递、被企业邀请的职位不计（exempt，PRD §2.5） */
export function recordJobView(viewed: string[], jobId: string, allowed: boolean, exempt = false): string[] {
  if (!allowed || exempt || viewed.includes(jobId)) return viewed
  return [...viewed, jobId]
}

/** 桌面列表右侧显示哪个职位。只有用户点过（explicit）才算"打开"，默认选中的第一条不扣额度 */
export function pickDetail(list: Job[], selectedId: string | null): { job: Job | undefined; explicit: boolean } {
  const chosen = selectedId ? list.find((j) => j.id === selectedId) : undefined
  return chosen ? { job: chosen, explicit: true } : { job: list[0], explicit: false }
}
