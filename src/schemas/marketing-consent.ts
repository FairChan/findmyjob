import { z } from 'zod'

export const marketingConsentSchema = z.discriminatedUnion('granted', [
  z.object({ granted: z.literal(true), submittedVersion: z.string().min(1).max(100) }).strict(),
  z.object({ granted: z.literal(false), submittedVersion: z.string().max(100).nullable().optional() }).strict(),
])
export type MarketingConsentInput = z.infer<typeof marketingConsentSchema>
