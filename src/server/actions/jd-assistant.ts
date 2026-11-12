'use server'

import { action } from '@/server/action'
import { generateJobDescriptionSchema } from '@/server/schemas/jd-assistant'
import { generateJobDescription } from '@/server/services/jd-assistant'

export const generateJobDescriptionAction = action(
  { auth: { type: 'company', minRole: 'RECRUITER' }, input: generateJobDescriptionSchema },
  async ctx => generateJobDescription({
    userId: ctx.userId!, companyId: ctx.companyId!, role: ctx.companyRole!,
  }, ctx.input),
)
