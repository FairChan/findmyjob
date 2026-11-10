import { z } from 'zod'
import { redact, REDACTED } from '@/lib/redact'

export const JD_SCHEMA_VERSION = 1 as const
export const JD_PROMPT_VERSION = 'jd-assistant-v1' as const
export const JD_OUTPUT_MAX_BYTES = 32 * 1024

export const generateJobDescriptionSchema = z.object({
  title: z.string().trim().min(1).max(200),
  points: z.string().trim().min(1).max(3000),
  acknowledged: z.literal(true),
  submittedVersion: z.string().min(1).max(100),
}).strict()
export type GenerateJobDescriptionInput = z.input<typeof generateJobDescriptionSchema>

// Official SDK structured-output conversion: no transforms or custom refinements.
export const jdSuggestionWireSchema = z.object({
  zh: z.string().min(1).max(4000), en: z.string().min(1).max(4000),
})
export const jdSuggestionSchema = z.object({
  zh: z.string().trim().min(1).max(4000), en: z.string().trim().min(1).max(4000),
})
export type JobDescriptionSuggestion = z.infer<typeof jdSuggestionSchema>

function hasUsefulText(value: string): boolean {
  return value.replaceAll(REDACTED, '').trim().length > 0
}

export function normalizeJdRequest(value: unknown): z.output<typeof generateJobDescriptionSchema> {
  const input = generateJobDescriptionSchema.parse(value)
  const result = generateJobDescriptionSchema.parse({
    title: redact(input.title).trim(), points: redact(input.points).trim(),
    acknowledged: input.acknowledged, submittedVersion: input.submittedVersion,
  })
  if (!hasUsefulText(result.title) || !hasUsefulText(result.points)) {
    throw new z.ZodError([{ code: 'custom', path: [], message: 'Career text is required' }])
  }
  return result
}

/** This validation is mandatory even when the provider SDK says it parsed structured output. */
export function normalizeJdSuggestion(value: unknown): JobDescriptionSuggestion {
  let serialized: string | undefined
  try { serialized = JSON.stringify(value) } catch { /* Reject non-JSON data below. */ }
  if (serialized === undefined || new TextEncoder().encode(serialized).byteLength > JD_OUTPUT_MAX_BYTES) {
    throw new z.ZodError([{ code: 'custom', path: [], message: 'Invalid or oversized output' }])
  }
  const selected = jdSuggestionWireSchema.parse(value)
  const result = jdSuggestionSchema.parse({ zh: redact(selected.zh), en: redact(selected.en) })
  if (!hasUsefulText(result.zh) || !hasUsefulText(result.en)) {
    throw new z.ZodError([{ code: 'custom', path: [], message: 'Two useful descriptions are required' }])
  }
  return result
}
