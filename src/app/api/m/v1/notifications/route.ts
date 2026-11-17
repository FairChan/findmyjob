import type { z } from 'zod'
import { route } from '@/server/route'
import { mobileOk } from '@/server/lib/mobile-api'
import { listMobileNotifications } from '@/server/services/mobile-student'
import { mobileCursorQuerySchema, mobileNotificationPageSchema } from '@/shared/mobile-api'

// 读列表不自动标已读（Web 由页面渲染后再调已读）；App 显式调 POST /notifications/read
export const GET = route({ auth: 'student', origin: 'app', input: mobileCursorQuerySchema }, async (_req, ctx) => {
  const input = ctx.input as z.infer<typeof mobileCursorQuerySchema>
  return mobileOk(mobileNotificationPageSchema, await listMobileNotifications({ userId: ctx.userId! }, input.cursor))
})
