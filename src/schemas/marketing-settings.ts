import { z } from 'zod'

// Disabled gates may retain an empty version; enabling always requires a published current version.
export const marketingGateInputSchema = z.object({
  enabled: z.boolean(), legalVersion: z.string().max(100),
}).strict()
