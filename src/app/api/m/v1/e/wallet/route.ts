import { route } from '@/server/route'
import { COMPANY_MEMBER, companyCtxOf, mobileOk } from '@/server/lib/mobile-api'
import { getMobileWallet } from '@/server/services/mobile-employer'
import { mobileWalletSchema } from '@/shared/mobile-api'

// 点数余额只读（与 Web 工作台一致：所有成员可见，未认证为 null）。/api/m/v1 没有任何购买或账单端点
export const GET = route({ auth: COMPANY_MEMBER, origin: 'app' }, async (_req, ctx) => {
  return mobileOk(mobileWalletSchema, await getMobileWallet(companyCtxOf(ctx)))
})
