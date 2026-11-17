import type { z } from 'zod'
import { route } from '@/server/route'
import { mobileOk } from '@/server/lib/mobile-api'
import { markAllNotificationsRead, markNotificationsRead } from '@/server/services/notifications'
import { mobileEmptySchema, mobileNotificationsReadSchema } from '@/shared/mobile-api'

export const POST = route({ auth: 'student', origin: 'app', input: mobileNotificationsReadSchema }, async (_req, ctx) => {
  const input = ctx.input as z.infer<typeof mobileNotificationsReadSchema>
  const user = { userId: ctx.userId! }
  if ('all' in input) await markAllNotificationsRead(user)
  else await markNotificationsRead(user, input.ids)
  return mobileOk(mobileEmptySchema, {})
})
