import { route } from '@/server/route'
import { mobileOk, pathIdAfter } from '@/server/lib/mobile-api'
import { deleteOwnResume } from '@/server/services/resume-files'
import { mobileEmptySchema } from '@/shared/mobile-api'

// 与 Web 同一个 service：删库（解析草稿级联删除）、重算完成度，提交后再清理存储里的全部版本
export const DELETE = route({ auth: 'student', origin: 'app' }, async (req, ctx) => {
  await deleteOwnResume({ userId: ctx.userId! }, pathIdAfter(req, 'resumes'))
  return mobileOk(mobileEmptySchema, {})
})
