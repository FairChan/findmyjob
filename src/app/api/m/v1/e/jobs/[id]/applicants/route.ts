import { route } from '@/server/route'
import { VERIFIED_COMPANY_MEMBER, companyCtxOf, mobileOk, pathIdAfter } from '@/server/lib/mobile-api'
import { listMobileApplicants } from '@/server/services/mobile-employer'
import { mobileApplicantListSchema } from '@/shared/mobile-api'

// 某职位的候选人（不含已撤回的）；学生信息只经 talent-card 序列化，别家公司的职位 404
export const GET = route({ auth: VERIFIED_COMPANY_MEMBER, origin: 'app' }, async (req, ctx) => {
  return mobileOk(mobileApplicantListSchema, await listMobileApplicants(companyCtxOf(ctx), pathIdAfter(req, 'jobs')))
})
