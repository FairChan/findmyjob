import { route } from '@/server/route'
import { mobileOk } from '@/server/lib/mobile-api'
import { completeOnboarding } from '@/server/services/student-profile'
import { mobileEmptySchema } from '@/shared/mobile-api'

// 与 Web 新手引导最后一步的 completeOnboardingAction 相同：前四节没填完是 422，
// 缺联系方式 CONTACT_REQUIRED，缺简历 RESUME_REQUIRED
export const POST = route({ auth: 'student', origin: 'app' }, async (_req, ctx) => {
  await completeOnboarding({ userId: ctx.userId! })
  return mobileOk(mobileEmptySchema, {})
})
