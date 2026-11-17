import { route } from '@/server/route'
import { mobileOk, pathIdAfter } from '@/server/lib/mobile-api'
import { declineInvitation } from '@/server/services/invitations'
import { mobileEmptySchema } from '@/shared/mobile-api'

export const POST = route({ auth: 'student', origin: 'app' }, async (req, ctx) => {
  const invitationId = pathIdAfter(req, 'invitations')
  await declineInvitation({ userId: ctx.userId! }, { invitationId })
  return mobileOk(mobileEmptySchema, {})
})
