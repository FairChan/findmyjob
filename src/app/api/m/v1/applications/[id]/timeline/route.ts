import { route } from '@/server/route'
import { mobileOk, pathIdAfter } from '@/server/lib/mobile-api'
import { getMobileApplicationTimeline } from '@/server/services/mobile-student'
import { mobileApplicationTimelineSchema } from '@/shared/mobile-api'

export const GET = route({ auth: 'student', origin: 'app' }, async (req, ctx) => {
  const applicationId = pathIdAfter(req, 'applications')
  return mobileOk(mobileApplicationTimelineSchema, await getMobileApplicationTimeline({ userId: ctx.userId! }, applicationId))
})
