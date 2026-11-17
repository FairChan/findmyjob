import { route } from '@/server/route'
import { VERIFIED_COMPANY_MEMBER, companyCtxOf, mobileOk, pathIdAfter } from '@/server/lib/mobile-api'
import { getMobileApplicant } from '@/server/services/mobile-employer'
import { mobileApplicantDetailSchema } from '@/shared/mobile-api'

// 候选人详情：toTalentDetail 输出，联系方式恒为 null（与 Web 一样，候选人详情不读联系方式）
export const GET = route({ auth: VERIFIED_COMPANY_MEMBER, origin: 'app' }, async (req, ctx) => {
  return mobileOk(mobileApplicantDetailSchema, await getMobileApplicant(companyCtxOf(ctx), pathIdAfter(req, 'applications')))
})
