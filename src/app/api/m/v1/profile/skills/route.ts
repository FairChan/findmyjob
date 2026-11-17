import { route } from '@/server/route'
import { mobileOk } from '@/server/lib/mobile-api'
import { saveStep3 } from '@/server/services/student-profile'
import { mobileEmptySchema, step3Schema, type Step3Data } from '@/shared/mobile-api'

// 语言、技能、一句话介绍和自我介绍一节；languages 是整组替换（与 Web 一致，增删改都靠提交完整列表）
export const PUT = route({ auth: 'student', origin: 'app', input: step3Schema }, async (_req, ctx) => {
  await saveStep3({ userId: ctx.userId! }, ctx.input as Step3Data)
  return mobileOk(mobileEmptySchema, {})
})
