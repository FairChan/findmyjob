import type { z } from 'zod'
import { route } from '@/server/route'
import { mobileOk } from '@/server/lib/mobile-api'
import { getClientIp } from '@/server/lib/client-ip'
import { recordLegalConsent } from '@/server/services/legal-consent'
import { mobileEmptySchema, mobileReconsentSchema } from '@/shared/mobile-api'

// App 收到 409 NEEDS_RECONSENT 后弹出条款页，用户同意后调这里；与 Web 的 submitReconsentAction 同一个 service。
// 版本必须等于当前 legal.currentVersion（从 GET /config 取），否则 409 VERSION_MISMATCH
export const POST = route({ auth: 'user', origin: 'app', reconsent: 'exempt', input: mobileReconsentSchema }, async (req, ctx) => {
  const input = ctx.input as z.infer<typeof mobileReconsentSchema>
  await recordLegalConsent(ctx.userId!, {
    submittedVersion: input.version,
    ip: getClientIp(req.headers) ?? undefined,
    userAgent: req.headers.get('user-agent') ?? undefined,
  })
  return mobileOk(mobileEmptySchema, {})
})
