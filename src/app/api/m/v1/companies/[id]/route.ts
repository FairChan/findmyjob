import type { z } from 'zod'
import { route } from '@/server/route'
import { mobileOk, pathIdAfter } from '@/server/lib/mobile-api'
import { getMobileCompany } from '@/server/services/mobile-student'
import { mobileCompanyDetailQuerySchema, mobileCompanyDetailSchema } from '@/shared/mobile-api'

export const GET = route({ auth: 'student', origin: 'app', input: mobileCompanyDetailQuerySchema }, async (req, ctx) => {
  const companyId = pathIdAfter(req, 'companies')
  const input = ctx.input as z.infer<typeof mobileCompanyDetailQuerySchema>
  return mobileOk(mobileCompanyDetailSchema, await getMobileCompany(companyId, input.jobsCursor))
})
