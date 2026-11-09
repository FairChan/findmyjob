'use server'
import { action } from '@/server/action'
import {
  deactivateCompany,
  deactivateCompanySchema,
  reactivateCompany,
  reactivateCompanySchema,
  setFoundingPartner,
  setFoundingPartnerSchema,
  setCompanyTags,
  setCompanyTagsSchema,
  adjustCompanyCredits,
  adjustCompanyCreditsSchema,
} from '@/server/services/admin-companies'

export const deactivateCompanyAction = action(
  { auth: 'admin', input: deactivateCompanySchema },
  async (ctx) => {
    return deactivateCompany({ userId: ctx.userId! }, ctx.input)
  },
)

export const reactivateCompanyAction = action(
  { auth: 'admin', input: reactivateCompanySchema },
  async (ctx) => {
    return reactivateCompany({ userId: ctx.userId! }, ctx.input)
  },
)

export const setFoundingPartnerAction = action(
  { auth: 'admin', input: setFoundingPartnerSchema },
  async (ctx) => {
    return setFoundingPartner({ userId: ctx.userId! }, ctx.input)
  },
)

export const setCompanyTagsAction = action(
  { auth: 'admin', input: setCompanyTagsSchema },
  async (ctx) => {
    return setCompanyTags({ userId: ctx.userId! }, ctx.input)
  },
)

export const adjustCompanyCreditsAction = action(
  { auth: 'admin-fresh', input: adjustCompanyCreditsSchema },
  async (ctx) => {
    return adjustCompanyCredits({ userId: ctx.userId! }, ctx.input)
  },
)
