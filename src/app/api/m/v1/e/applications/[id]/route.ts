import { route } from '@/server/route'
import { VERIFIED_COMPANY_MEMBER, companyCtxOf, mobileOk, pathIdAfter } from '@/server/lib/mobile-api'
import { getMobileApplicant } from '@/server/services/mobile-employer'
import { mobileApplicantDetailSchema } from '@/shared/mobile-api'

// 候选人详情：与 Web 看板点开候选人相同——只认本公司、非 WITHDRAWN 的投递，profile 走 viewTalentProfile
// （屏蔽和可见性检查、ProfileView、每日查看上限、talent.view 审计都与 Web 人才详情相同）。会计数，App 只能在用户点击时调用
export const GET = route({ auth: VERIFIED_COMPANY_MEMBER, origin: 'app' }, async (req, ctx) => {
  return mobileOk(mobileApplicantDetailSchema, await getMobileApplicant(companyCtxOf(ctx), pathIdAfter(req, 'applications')))
})
