import { route } from '@/server/route'
import { mobileOk } from '@/server/lib/mobile-api'
import { saveStep4, step4Schema, type Step4Data } from '@/server/services/student-profile'
import { mobileEmptySchema } from '@/shared/mobile-api'

// 教育和经历一节：两组列表整组替换，sortOrder 决定顺序（与 Web 拖拽排序后的提交一致）
export const PUT = route({ auth: 'student', origin: 'app', input: step4Schema }, async (_req, ctx) => {
  await saveStep4({ userId: ctx.userId! }, ctx.input as Step4Data)
  return mobileOk(mobileEmptySchema, {})
})
