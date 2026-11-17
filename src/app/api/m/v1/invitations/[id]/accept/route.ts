import { route } from '@/server/route'
import { mobileOk, pathIdAfter } from '@/server/lib/mobile-api'
import { acceptInvitation } from '@/server/services/invitations'
import { mobileApplicationRefSchema } from '@/shared/mobile-api'

// 接受邀请等于投递该职位（走 applyToJob 的全部校验），被邀请的职位不扣查看额度
export const POST = route({ auth: 'student', origin: 'app' }, async (req, ctx) => {
  const invitationId = pathIdAfter(req, 'invitations')
  return mobileOk(mobileApplicationRefSchema, await acceptInvitation({ userId: ctx.userId! }, { invitationId }))
})
