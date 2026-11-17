import { route } from '@/server/route'
import { mobileOk, pathIdAfter } from '@/server/lib/mobile-api'
import { previewMobileJob } from '@/server/services/mobile-student'
import { mobileJobPreviewSchema } from '@/shared/mobile-api'

// 预览不产生 JobView、不扣额度；看完整详情要显式调用 POST /jobs/:id/open
export const GET = route({ auth: 'student', origin: 'app' }, async (req, ctx) => {
  const jobId = pathIdAfter(req, 'jobs')
  return mobileOk(mobileJobPreviewSchema, await previewMobileJob({ userId: ctx.userId! }, jobId))
})
