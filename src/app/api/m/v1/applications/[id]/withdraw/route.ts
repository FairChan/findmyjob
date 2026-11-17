import { route } from '@/server/route'
import { mobileOk, pathIdAfter } from '@/server/lib/mobile-api'
import { withdrawApplication } from '@/server/services/applications'
import { mobileEmptySchema } from '@/shared/mobile-api'

// 只能撤回自己的投递（别人的 id 返回 404）；重复撤回是幂等的
export const POST = route({ auth: 'student', origin: 'app' }, async (req, ctx) => {
  const applicationId = pathIdAfter(req, 'applications')
  await withdrawApplication({ userId: ctx.userId! }, { applicationId })
  return mobileOk(mobileEmptySchema, {})
})
