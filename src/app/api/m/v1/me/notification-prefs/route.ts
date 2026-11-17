import { route } from '@/server/route'
import { mobileOk } from '@/server/lib/mobile-api'
import { getMobileNotificationPrefs } from '@/server/services/mobile-student-write'
import { setMarketingConsent } from '@/server/services/marketing-consent'
import { marketingConsentSchema, type MarketingConsentInput } from '@/schemas/marketing-consent'
import { mobileNotificationPrefsSchema } from '@/shared/mobile-api'

// 学生目前唯一可控的通知偏好是每周职位周报邮件，背后是 MARKETING 同意（写 marketing.consent 审计）
export const GET = route({ auth: 'student', origin: 'app', reconsent: 'exempt' }, async (_req, ctx) => {
  return mobileOk(mobileNotificationPrefsSchema, await getMobileNotificationPrefs({ userId: ctx.userId! }))
})

export const PUT = route({ auth: 'student', origin: 'app', reconsent: 'exempt', input: marketingConsentSchema }, async (_req, ctx) => {
  const user = { userId: ctx.userId! }
  await setMarketingConsent(user, ctx.input as MarketingConsentInput)
  return mobileOk(mobileNotificationPrefsSchema, await getMobileNotificationPrefs(user))
})
