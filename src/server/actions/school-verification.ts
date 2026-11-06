'use server'
import { action } from '@/server/action'
import {
  requestOtpSchema,
  verifyOtpSchema,
  requestSchoolOtp,
  verifySchoolOtp,
  listActiveSchools,
} from '@/server/services/school-verification'

export const listActiveSchoolsAction = action({ auth: 'student' }, async () => {
  const schools = await listActiveSchools()
  return { schools }
})

export const requestSchoolOtpAction = action(
  { auth: 'student', input: requestOtpSchema },
  async ({ userId, input }) => {
    await requestSchoolOtp({ userId: userId! }, input)
    return {}
  },
)

export const verifySchoolOtpAction = action(
  { auth: 'student', input: verifyOtpSchema },
  async ({ userId, input }) => {
    await verifySchoolOtp({ userId: userId! }, input)
    return {}
  },
)
