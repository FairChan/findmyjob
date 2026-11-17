import { route } from '@/server/route'
import { COMPANY_MEMBER, companyCtxOf, mobileOk } from '@/server/lib/mobile-api'
import { searchMobileTalent } from '@/server/services/mobile-employer'
import { mobileTalentPageSchema, mobileTalentQuerySchema, type MobileTalentQuery } from '@/shared/mobile-api'

// 人才库搜索：与 Web /e/talent 同一个 searchTalents（企业须已认证、页数上限、每人每天翻页上限、关键词 redact）。
// 每次调用都计入每日翻页数，App 不预取、不自动重取
export const GET = route({ auth: COMPANY_MEMBER, origin: 'app', input: mobileTalentQuerySchema }, async (_req, ctx) => {
  return mobileOk(mobileTalentPageSchema, await searchMobileTalent(companyCtxOf(ctx), ctx.input as MobileTalentQuery))
})
