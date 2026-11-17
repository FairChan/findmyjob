import { route } from '@/server/route'
import { getSession } from '@/server/auth'
import { ForbiddenError } from '@/server/errors'
import { registerDeviceToken } from '@/server/services/device-tokens'
import { mobileRegisterDeviceSchema, type MobileRegisterDevice } from '@/shared/mobile-api'

// 注册本机推送 token（MA3-T01），绑定到当前登录会话：会话没了，token 也随之删除
export const POST = route({ auth: 'student', origin: 'app', input: mobileRegisterDeviceSchema }, async (req, ctx) => {
  const session = await getSession(req.headers)
  if (!session?.session.id) throw new ForbiddenError()
  const input = ctx.input as MobileRegisterDevice
  const data = await registerDeviceToken(
    { userId: ctx.userId!, sessionId: session.session.id },
    { token: input.token, appVersion: input.appVersion ?? null, locale: input.locale },
  )
  return Response.json({ ok: true, data })
})
