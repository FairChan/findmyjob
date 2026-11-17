import { route } from '@/server/route'
import { mobileOk } from '@/server/lib/mobile-api'
import { verifyOtpSchema, verifySchoolOtp, type VerifyOtpInput } from '@/server/services/school-verification'
import { mobileEmptySchema } from '@/shared/mobile-api'

// 错误次数锁定（5 次锁 30 分钟）在 service 里，返回 429 RATE_LIMITED
export const POST = route({ auth: 'student', origin: 'app', input: verifyOtpSchema }, async (_req, ctx) => {
  await verifySchoolOtp({ userId: ctx.userId! }, ctx.input as VerifyOtpInput)
  return mobileOk(mobileEmptySchema, {})
})
