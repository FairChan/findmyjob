import { route } from '@/server/route'
import { mobileOk } from '@/server/lib/mobile-api'
import { getMobileProfile } from '@/server/services/mobile-student'
import { mobileProfileSchema } from '@/shared/mobile-api'

export const GET = route({ auth: 'student', origin: 'app' }, async (_req, ctx) => {
  return mobileOk(mobileProfileSchema, await getMobileProfile({ userId: ctx.userId! }))
})
