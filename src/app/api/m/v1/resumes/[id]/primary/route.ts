import { route } from '@/server/route'
import { mobileOk, pathIdAfter } from '@/server/lib/mobile-api'
import { setPrimaryOwnResume } from '@/server/services/resume-files'
import { mobileEmptySchema } from '@/shared/mobile-api'

// 与 Web 简历页"设为主简历"同一个 service；别人的简历返回 403
export const POST = route({ auth: 'student', origin: 'app' }, async (req, ctx) => {
  await setPrimaryOwnResume({ userId: ctx.userId! }, pathIdAfter(req, 'resumes'))
  return mobileOk(mobileEmptySchema, {})
})
