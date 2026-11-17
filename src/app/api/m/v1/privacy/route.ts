import type { z } from 'zod'
import { route } from '@/server/route'
import { mobileOk } from '@/server/lib/mobile-api'
import { getClientIp } from '@/server/lib/client-ip'
import { getMobilePrivacy } from '@/server/services/mobile-student-write'
import { setVisibility } from '@/server/services/privacy'
import { mobileEmptySchema, mobilePrivacySchema, mobileVisibilitySchema } from '@/shared/mobile-api'

export const GET = route({ auth: 'student', origin: 'app' }, async (_req, ctx) => {
  return mobileOk(mobilePrivacySchema, await getMobilePrivacy({ userId: ctx.userId! }))
})

// 人才库开关：开启要求已同意当前版本的条款和隐私政策（service 校验），关闭随时可以；写 Consent 和审计
export const PUT = route({ auth: 'student', origin: 'app', input: mobileVisibilitySchema }, async (req, ctx) => {
  const input = ctx.input as z.infer<typeof mobileVisibilitySchema>
  await setVisibility({ userId: ctx.userId! }, input, { ip: getClientIp(req.headers) })
  return mobileOk(mobileEmptySchema, {})
})
