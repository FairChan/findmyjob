import { route } from '@/server/route'
import { mobileOk } from '@/server/lib/mobile-api'
import { getMobileReferrals } from '@/server/services/mobile-student'
import { mobileReferralsSchema } from '@/shared/mobile-api'

export const GET = route({ auth: 'student', origin: 'app' }, async (_req, ctx) => {
  return mobileOk(mobileReferralsSchema, await getMobileReferrals({ userId: ctx.userId! }))
})
