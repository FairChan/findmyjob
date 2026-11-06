'use server'
import { action } from '@/server/action'
import { submitVerification, submitVerificationSchema } from '@/server/services/verification'

export const submitVerificationAction = action(
  { auth: { type: 'company', minRole: 'ADMIN' }, input: submitVerificationSchema },
  async ctx => {
    return submitVerification(
      { userId: ctx.userId!, companyId: ctx.companyId!, role: ctx.companyRole! },
      ctx.input,
    )
  },
)
