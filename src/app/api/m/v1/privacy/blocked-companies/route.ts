import type { z } from 'zod'
import { route } from '@/server/route'
import { mobileOk } from '@/server/lib/mobile-api'
import { addBlockedCompany } from '@/server/services/privacy'
import { mobileBlockCompanySchema, mobileEmptySchema } from '@/shared/mobile-api'

// 屏蔽后该企业在人才库里看不到这名学生；写 student.block_company 审计
export const POST = route({ auth: 'student', origin: 'app', input: mobileBlockCompanySchema }, async (_req, ctx) => {
  await addBlockedCompany({ userId: ctx.userId! }, ctx.input as z.infer<typeof mobileBlockCompanySchema>)
  return mobileOk(mobileEmptySchema, {})
})
