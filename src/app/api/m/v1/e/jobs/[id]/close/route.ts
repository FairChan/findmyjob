import { route } from '@/server/route'
import { COMPANY_MEMBER, companyCtxOf, mobileOk, pathIdAfter } from '@/server/lib/mobile-api'
import { closeMobileEmployerJob } from '@/server/services/mobile-employer'
import { mobileEmployerJobStatusSchema } from '@/shared/mobile-api'

// 关闭职位：与 Web closeJobAction 同一个 service（RECRUITER 起、草稿和被拒的不能关、重复关闭幂等）。
// Web 没有"暂停/恢复"，重新上架要在 Web 编辑后重新提交审核，所以 App 也只有关闭
export const POST = route({ auth: COMPANY_MEMBER, origin: 'app' }, async (req, ctx) => {
  return mobileOk(mobileEmployerJobStatusSchema, await closeMobileEmployerJob(companyCtxOf(ctx), pathIdAfter(req, 'jobs')))
})
