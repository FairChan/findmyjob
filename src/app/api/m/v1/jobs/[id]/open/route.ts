import { route } from '@/server/route'
import { mobileOk, pathIdAfter } from '@/server/lib/mobile-api'
import { openMobileJob } from '@/server/services/mobile-student-write'
import { mobileJobOpenSchema } from '@/shared/mobile-api'

// 唯一会扣额度的端点。用 POST 而不是 GET：只能由用户点击触发，App 的查询层不会预取或自动重取它
export const POST = route({ auth: 'student', origin: 'app' }, async (req, ctx) => {
  const jobId = pathIdAfter(req, 'jobs')
  return mobileOk(mobileJobOpenSchema, await openMobileJob({ userId: ctx.userId! }, jobId))
})
