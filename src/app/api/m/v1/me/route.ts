import { route } from '@/server/route'
import { getMobileMe } from '@/server/services/mobile-app'

export const GET = route({ auth: 'user', origin: 'app', reconsent: 'exempt' }, async (_req, ctx) => {
  return Response.json({ ok: true, data: await getMobileMe({ userId: ctx.userId! }) })
})
