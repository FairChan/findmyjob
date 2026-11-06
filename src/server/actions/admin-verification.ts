'use server'
import { action } from '@/server/action'
import {
  approveCompany,
  approveCompanySchema,
  rejectCompany,
  rejectCompanySchema,
} from '@/server/services/review-company'

export const approveCompanyAction = action(
  { auth: 'admin', input: approveCompanySchema },
  async ctx => {
    return approveCompany({ userId: ctx.userId! }, ctx.input)
  },
)

export const rejectCompanyAction = action(
  { auth: 'admin', input: rejectCompanySchema },
  async ctx => {
    return rejectCompany({ userId: ctx.userId! }, ctx.input)
  },
)
