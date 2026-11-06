'use server'
import { action } from '@/server/action'
import { headers } from 'next/headers'
import { getClientIp } from '@/server/lib/client-ip'
import {
  setVisibilitySchema,
  blockCompanySchema,
  unblockCompanySchema,
  searchCompaniesSchema,
  setVisibility,
  addBlockedCompany,
  removeBlockedCompany,
  searchVerifiedCompanies,
} from '@/server/services/privacy'

export const setVisibilityAction = action(
  { auth: 'student', input: setVisibilitySchema },
  async ({ userId, input }) => {
    const h = await headers()
    const ip = getClientIp(h)
    await setVisibility({ userId: userId! }, input, { ip })
    return {}
  },
)

export const addBlockedCompanyAction = action(
  { auth: 'student', input: blockCompanySchema },
  async ({ userId, input }) => {
    await addBlockedCompany({ userId: userId! }, input)
    return {}
  },
)

export const removeBlockedCompanyAction = action(
  { auth: 'student', input: unblockCompanySchema },
  async ({ userId, input }) => {
    await removeBlockedCompany({ userId: userId! }, input)
    return {}
  },
)

export const searchVerifiedCompaniesAction = action(
  { auth: 'student', input: searchCompaniesSchema },
  async ({ input }) => {
    const companies = await searchVerifiedCompanies(input)
    return { companies }
  },
)
