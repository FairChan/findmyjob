import type { z } from 'zod'
import { route } from '@/server/route'
import { mobileOk } from '@/server/lib/mobile-api'
import { searchVerifiedCompanies } from '@/server/services/privacy'
import { mobileCompanySearchQuerySchema, mobileCompanySearchSchema } from '@/shared/mobile-api'

// 屏蔽企业前先搜企业名；只返回已认证企业的 id 和显示名
export const GET = route({ auth: 'student', origin: 'app', input: mobileCompanySearchQuerySchema }, async (_req, ctx) => {
  const input = ctx.input as z.infer<typeof mobileCompanySearchQuerySchema>
  return mobileOk(mobileCompanySearchSchema, { items: await searchVerifiedCompanies(input) })
})
