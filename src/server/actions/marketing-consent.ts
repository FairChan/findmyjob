'use server'
import { action } from '@/server/action'
import { marketingConsentSchema } from '@/schemas/marketing-consent'
import { setMarketingConsent } from '@/server/services/marketing-consent'

// The service restricts the authenticated actor to ACTIVE STUDENT/EMPLOYER.
// Personal withdrawal must not depend on company membership or current legal grants.
export const setMarketingConsentAction = action(
  { auth: 'user', input: marketingConsentSchema },
  async ({ userId, input }) => {
    await setMarketingConsent({ userId: userId! }, input)
    return {}
  },
)
