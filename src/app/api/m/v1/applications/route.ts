import { route } from '@/server/route'
import { mobileOk } from '@/server/lib/mobile-api'
import { listMobileApplications } from '@/server/services/mobile-student'
import { mobileApplicationListSchema } from '@/shared/mobile-api'

export const GET = route({ auth: 'student', origin: 'app' }, async (_req, ctx) => {
  return mobileOk(mobileApplicationListSchema, await listMobileApplications({ userId: ctx.userId! }))
})
