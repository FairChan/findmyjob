import { route } from '@/server/route'
import { VERIFIED_COMPANY_MEMBER, companyCtxOf, mobileOk, pathIdAfter } from '@/server/lib/mobile-api'
import { markApplicationViewed } from '@/server/services/applicants'
import { mobileEmptySchema } from '@/shared/mobile-api'

// 首次打开候选人时 APPLIED → VIEWED（与 Web 的 markViewedAction 相同；已过 APPLIED 或别家公司的投递是 no-op）
export const POST = route({ auth: VERIFIED_COMPANY_MEMBER, origin: 'app' }, async (req, ctx) => {
  await markApplicationViewed(companyCtxOf(ctx), pathIdAfter(req, 'applications'))
  return mobileOk(mobileEmptySchema, {})
})
