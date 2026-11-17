import { route } from '@/server/route'
import { getPushPreferences, updatePushPreferences } from '@/server/services/device-tokens'
import { mobilePushPreferencesPatchSchema, type MobilePushPreferences } from '@/shared/mobile-api'

export const GET = route({ auth: 'student', origin: 'app' }, async (_req, ctx) => {
  return Response.json({ ok: true, data: await getPushPreferences({ userId: ctx.userId! }) })
})

export const PATCH = route({ auth: 'student', origin: 'app', input: mobilePushPreferencesPatchSchema }, async (_req, ctx) => {
  const data = await updatePushPreferences({ userId: ctx.userId! }, ctx.input as Partial<MobilePushPreferences>)
  return Response.json({ ok: true, data })
})
