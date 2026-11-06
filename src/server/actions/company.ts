'use server'
import { z } from 'zod'
import { action } from '@/server/action'
import { createCompany, updateCompany, createCompanySchema, updateCompanySchema } from '@/server/services/company'

export const createCompanyAction = action(
  { auth: 'user', input: createCompanySchema },
  async ctx => {
    const { userId, input } = ctx
    return createCompany({ userId: userId! }, input)
  },
)

export const updateCompanyAction = action(
  {
    auth: { type: 'company', minRole: 'ADMIN' },
    input: updateCompanySchema,
  },
  async ctx => {
    const { userId, companyId, companyRole, input } = ctx
    return updateCompany({ userId: userId!, companyId: companyId!, role: companyRole! }, input)
  },
)

export const getMyCompanyAction = action(
  { auth: 'user' },
  async ctx => {
    const { getMyCompany } = await import('@/server/services/company')
    return getMyCompany({ userId: ctx.userId! })
  },
)
