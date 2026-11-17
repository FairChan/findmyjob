import { route } from '@/server/route'
import { mobileOk, pathIdAfter } from '@/server/lib/mobile-api'
import { removeBlockedCompany } from '@/server/services/privacy'
import { mobileEmptySchema } from '@/shared/mobile-api'

// 取消屏蔽；写 student.unblock_company 审计
export const DELETE = route({ auth: 'student', origin: 'app', reconsent: 'exempt' }, async (req, ctx) => {
  const companyId = pathIdAfter(req, 'blocked-companies')
  await removeBlockedCompany({ userId: ctx.userId! }, { companyId })
  return mobileOk(mobileEmptySchema, {})
})
