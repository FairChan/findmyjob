import { route } from '@/server/route'
import { mobileOk } from '@/server/lib/mobile-api'
import { requestOtpSchema, requestSchoolOtp, type RequestOtpInput } from '@/server/services/school-verification'
import { mobileEmptySchema } from '@/shared/mobile-api'

// 域名校验和发送限流都在 service 里；OTP 只发到学校邮箱，响应里不带任何验证码信息
export const POST = route({ auth: 'student', origin: 'app', input: requestOtpSchema }, async (_req, ctx) => {
  await requestSchoolOtp({ userId: ctx.userId! }, ctx.input as RequestOtpInput)
  return mobileOk(mobileEmptySchema, {})
})
