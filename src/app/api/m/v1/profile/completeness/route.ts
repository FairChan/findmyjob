import { route } from '@/server/route'
import { mobileOk } from '@/server/lib/mobile-api'
import { getMobileProfileCompleteness } from '@/server/services/mobile-student'
import { mobileProfileCompletenessSchema } from '@/shared/mobile-api'

export const GET = route({ auth: 'student', origin: 'app' }, async (_req, ctx) => {
  return mobileOk(mobileProfileCompletenessSchema, await getMobileProfileCompleteness({ userId: ctx.userId! }))
})
