import { route } from '@/server/route'
import { mobileOk } from '@/server/lib/mobile-api'
import { listMobileInvitations } from '@/server/services/mobile-student'
import { mobileInvitationListSchema } from '@/shared/mobile-api'

export const GET = route({ auth: 'student', origin: 'app' }, async (_req, ctx) => {
  return mobileOk(mobileInvitationListSchema, await listMobileInvitations({ userId: ctx.userId! }))
})
