import { route } from '@/server/route'
import { mobileOk } from '@/server/lib/mobile-api'
import { saveStep2 } from '@/server/services/student-profile'
import { mobileEmptySchema, step2Schema, type Step2Data } from '@/shared/mobile-api'

// 求职意向一节（类型、可到岗时间、地区、行业、期望薪资），整节替换
export const PUT = route({ auth: 'student', origin: 'app', input: step2Schema }, async (_req, ctx) => {
  await saveStep2({ userId: ctx.userId! }, ctx.input as Step2Data)
  return mobileOk(mobileEmptySchema, {})
})
