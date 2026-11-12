import { z } from 'zod'

export const MATCHING_CONFIGURATION_ID = 'matching-public-v1' as const
export const MATCHING_TEMPLATE_VERSION = 'matching-public-v1' as const
export const MATCHING_DIMENSION = 1024 as const
export const matchingGateSchema = z.object({
  enabled: z.boolean(), legalVersion: z.string().min(1).max(100).nullable(),
  epoch: z.string().uuid(), configurationId: z.literal(MATCHING_CONFIGURATION_ID),
}).strict()
export const embeddingVectorSchema = z.array(z.number().finite()).length(MATCHING_DIMENSION).superRefine((values, ctx) => {
  const floats = values.map(Math.fround)
  const norm = Math.hypot(...floats)
  if (floats.some(value => !Number.isFinite(value)) || !Number.isFinite(norm) || norm <= 0) {
    ctx.addIssue({ code: 'custom', message: 'Invalid finite nonzero float32 vector' })
  }
})
export const recommendTalentsSchema = z.object({
  jobId: z.string().cuid(), limit: z.number().int().min(1).max(20).default(10),
}).strict()
export const recommendJobsSchema = z.object({ limit: z.number().int().min(1).max(20).default(10) }).strict()
export const matchingConsentSchema = z.discriminatedUnion('granted', [
  z.object({ granted: z.literal(true), submittedVersion: z.string().min(1).max(100) }).strict(),
  z.object({ granted: z.literal(false), submittedVersion: z.string().min(1).max(100).nullable().optional() }).strict(),
])

export const matchingGateInputSchema = matchingGateSchema.omit({ epoch: true }).strict()
