import type { z } from 'zod'
import { route } from '@/server/route'
import { mobileOk } from '@/server/lib/mobile-api'
import { setMobileLocale } from '@/server/services/mobile-student-write'
import { mobileLocaleResultSchema, mobileLocaleSchema } from '@/shared/mobile-api'

// 邮件和推送的语言跟着 User.locale 走；与 Web 设置页一样只要求登录（auth: 'user'）
export const PATCH = route({ auth: 'user', origin: 'app', input: mobileLocaleSchema }, async (_req, ctx) => {
  const input = ctx.input as z.infer<typeof mobileLocaleSchema>
  return mobileOk(mobileLocaleResultSchema, await setMobileLocale({ userId: ctx.userId! }, input.locale))
})
