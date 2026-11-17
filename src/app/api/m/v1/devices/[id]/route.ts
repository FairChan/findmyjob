import { z } from 'zod'
import { route } from '@/server/route'
import { revokeDeviceToken } from '@/server/services/device-tokens'

const idSchema = z.string().cuid()

// App 退出登录前注销本机 token；只能注销自己的。退出登录不能被"需要重新同意条款"挡住，所以豁免（MA1-T07）
export const DELETE = route({ auth: 'student', origin: 'app', reconsent: 'exempt' }, async (req, ctx) => {
  const id = idSchema.safeParse(new URL(req.url).pathname.split('/').pop())
  if (!id.success) return Response.json({ ok: false, code: 'VALIDATION_ERROR' }, { status: 400 })
  await revokeDeviceToken({ userId: ctx.userId! }, id.data)
  return Response.json({ ok: true, data: {} })
})
