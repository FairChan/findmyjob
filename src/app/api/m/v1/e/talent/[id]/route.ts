import { route } from '@/server/route'
import { COMPANY_MEMBER, companyCtxOf, mobileOk, pathIdAfter } from '@/server/lib/mobile-api'
import { viewMobileTalent } from '@/server/services/mobile-employer'
import { mobileTalentViewSchema } from '@/shared/mobile-api'

// 学生详情：与 Web /e/talent/:id 同一个 viewTalentProfile（写 ProfileView 和 talent.view 审计，按成员和公司计每日查看上限）。
// 会计数，App 只能在用户点击时调用
export const GET = route({ auth: COMPANY_MEMBER, origin: 'app' }, async (req, ctx) => {
  return mobileOk(mobileTalentViewSchema, await viewMobileTalent(companyCtxOf(ctx), pathIdAfter(req, 'talent')))
})
