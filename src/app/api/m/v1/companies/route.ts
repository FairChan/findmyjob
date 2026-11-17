import type { z } from 'zod'
import { route } from '@/server/route'
import { mobileOk } from '@/server/lib/mobile-api'
import { listMobileCompanies } from '@/server/services/mobile-student'
import { mobileCompaniesQuerySchema, mobileCompanyPageSchema } from '@/shared/mobile-api'

export const GET = route({ auth: 'student', origin: 'app', input: mobileCompaniesQuerySchema }, async (_req, ctx) => {
  const input = ctx.input as z.infer<typeof mobileCompaniesQuerySchema>
  return mobileOk(mobileCompanyPageSchema, await listMobileCompanies(input))
})
