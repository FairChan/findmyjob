import { route } from '@/server/route'
import { mobileOk } from '@/server/lib/mobile-api'
import { listMobileJobs } from '@/server/services/mobile-student'
import { mobileJobPageSchema, mobileJobsQuerySchema, type MobileJobsQuery } from '@/shared/mobile-api'

// 职位列表：游标分页，不扣额度
export const GET = route({ auth: 'student', origin: 'app', input: mobileJobsQuerySchema }, async (_req, ctx) => {
  return mobileOk(mobileJobPageSchema, await listMobileJobs(ctx.input as MobileJobsQuery))
})
