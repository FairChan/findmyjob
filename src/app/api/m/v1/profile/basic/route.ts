import { route } from '@/server/route'
import { mobileOk } from '@/server/lib/mobile-api'
import { saveStep1, step1Schema, type Step1Data } from '@/server/services/student-profile'
import { mobileEmptySchema } from '@/shared/mobile-api'

// 与 Web 档案页"基本信息"一节同一个 service 和 schema：整节替换，换学校会清掉学校认证
export const PUT = route({ auth: 'student', origin: 'app', input: step1Schema }, async (_req, ctx) => {
  await saveStep1({ userId: ctx.userId! }, ctx.input as Step1Data)
  return mobileOk(mobileEmptySchema, {})
})
