import { route } from '@/server/route'
import { VERIFIED_COMPANY_MEMBER, companyCtxOf, mobileOk, pathIdAfter } from '@/server/lib/mobile-api'
import { unlockMobileTalent } from '@/server/services/mobile-employer'
import { mobileUnlockResultSchema } from '@/shared/mobile-api'

// 解锁：与 Web unlockStudentAction 同一个 unlockStudent（CREDIT 锁事务内 applyLedgerEntry 扣点、每日上限、
// 已解锁不重复扣、写 talent.unlock 审计）。点数不足 402 INSUFFICIENT_CREDITS；App 里不提供购买入口
export const POST = route({ auth: VERIFIED_COMPANY_MEMBER, origin: 'app' }, async (req, ctx) => {
  return mobileOk(mobileUnlockResultSchema, await unlockMobileTalent(companyCtxOf(ctx), pathIdAfter(req, 'talent')))
})
