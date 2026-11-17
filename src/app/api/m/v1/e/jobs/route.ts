import { route } from '@/server/route'
import { COMPANY_MEMBER, companyCtxOf, mobileOk } from '@/server/lib/mobile-api'
import { listMobileEmployerJobs } from '@/server/services/mobile-employer'
import { mobileEmployerJobListSchema } from '@/shared/mobile-api'

// 本公司全部职位（与 Web /e/jobs 相同，RECRUITER 起）；App 里不新建、不编辑职位
export const GET = route({ auth: COMPANY_MEMBER, origin: 'app' }, async (_req, ctx) => {
  return mobileOk(mobileEmployerJobListSchema, await listMobileEmployerJobs(companyCtxOf(ctx)))
})
