import { z } from 'zod'
import { redact, REDACTED } from '@/lib/redact'

export const RESUME_SCHEMA_VERSION = 1 as const
export const RESUME_PROMPT_VERSION = 'resume-parse-v1' as const
export const RESUME_SUGGESTION_MAX_BYTES = 128 * 1024

const degreeLevel = z.enum(['FOUNDATION', 'DIPLOMA', 'BACHELOR', 'MASTER', 'PHD'])
const languageLevel = z.enum(['BASIC', 'CONVERSATIONAL', 'FLUENT', 'NATIVE'])
const experienceKind = z.enum(['INTERNSHIP', 'WORK', 'PROJECT', 'CAMPUS', 'AWARD'])
export {
  degreeLevel as resumeDegreeLevelSchema,
  languageLevel as resumeLanguageLevelSchema,
  experienceKind as resumeExperienceKindSchema,
}

// SDK structured-output conversion needs a schema without transforms or custom refinements.
// It is a transport shape only; worker persistence always uses normalizeResumeSuggestion.
const wireDate = z.union([
  z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  z.string().datetime({ offset: true }),
]).nullable()
export const resumeSuggestionWireSchema = z.object({
  headline: z.string().max(100).nullable(), summary: z.string().max(2000).nullable(),
  skills: z.array(z.string().min(1).max(50)).max(30),
  languages: z.array(z.object({ language: z.string().min(1).max(20), level: languageLevel })).max(20),
  educations: z.array(z.object({
    schoolName: z.string().min(1).max(200), degreeLevel: degreeLevel.nullable(),
    major: z.string().max(100).nullable(), startDate: wireDate, endDate: wireDate,
    gpa: z.string().max(20).nullable(), description: z.string().max(1000).nullable(),
  })).max(20),
  experiences: z.array(z.object({
    kind: experienceKind, title: z.string().min(1).max(200), organization: z.string().max(200).nullable(),
    startDate: wireDate, endDate: wireDate, description: z.string().max(1000).nullable(),
  })).max(50),
})
const text = (max: number) => z.string().trim().max(max)
const requiredText = (max: number) => text(max).min(1)

function isRealDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:$|T)/.exec(value)
  if (!match) return false
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
  return month >= 1 && month <= 12 && day >= 1 && day <= days[month - 1]!
}

const completeDate = z.union([
  z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  z.string().datetime({ offset: true }),
]).refine(isRealDate, 'Date must be a real complete calendar date')
  .refine(value => Number.isFinite(Date.parse(value)), 'Invalid date')
  .transform(value => new Date(value).toISOString())
  .nullable()

function dateOrder(value: { startDate: string | null; endDate: string | null }, ctx: z.RefinementCtx): void {
  if (value.startDate !== null && value.endDate !== null && Date.parse(value.startDate) > Date.parse(value.endDate)) {
    ctx.addIssue({ code: 'custom', path: ['endDate'], message: 'End date precedes start date' })
  }
}

const language = z.object({ language: requiredText(20), level: languageLevel })
const education = z.object({
  schoolName: requiredText(200), degreeLevel: degreeLevel.nullable(),
  major: text(100).nullable(), startDate: completeDate, endDate: completeDate,
  gpa: text(20).nullable(), description: text(1000).nullable(),
}).superRefine(dateOrder)
const experience = z.object({
  kind: experienceKind, title: requiredText(200), organization: text(200).nullable(),
  startDate: completeDate, endDate: completeDate, description: text(1000).nullable(),
}).superRefine(dateOrder)

function deduplicateSkills(values: string[]): string[] {
  const seen = new Set<string>()
  return values.filter(value => {
    const key = value.toLowerCase()
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

const skills = z.array(requiredText(50)).max(30).transform(deduplicateSkills)
const languages = z.array(language).max(20).superRefine((values, ctx) => {
  const levels = new Map<string, string>()
  values.forEach((value, index) => {
    const key = value.language.toLowerCase()
    const prior = levels.get(key)
    if (prior !== undefined && prior !== value.level) {
      ctx.addIssue({ code: 'custom', path: [index, 'level'], message: 'Conflicting language levels' })
    }
    levels.set(key, value.level)
  })
}).transform(values => {
  const seen = new Set<string>()
  return values.filter(value => {
    const key = value.language.toLowerCase()
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
})

// All six groups are required. Nested objects strip unknown ownership/identity fields.
export const resumeSuggestionSchema = z.object({
  headline: text(100).nullable(), summary: text(2000).nullable(), skills, languages,
  educations: z.array(education).max(20), experiences: z.array(experience).max(50),
})
export type ResumeSuggestionV1 = z.infer<typeof resumeSuggestionSchema>

export const resumePatchSchema = resumeSuggestionSchema.partial().refine(
  value => Object.values(value).some(item => item !== undefined),
  'Select at least one profile field',
)
export const resumeIdSchema = z.object({ resumeId: z.string().min(1).max(128) })
export const requestResumeParseSchema = resumeIdSchema.extend({
  expectedGeneration: z.number().int().positive().optional(),
})
export const discardResumeParseSchema = resumeIdSchema.extend({ generation: z.number().int().positive() })
export const confirmResumeParseSchema = discardResumeParseSchema.extend({
  expectedProfileRevision: z.number().int().nonnegative(), patch: resumePatchSchema,
})
export const resumeParseConsentSchema = z.discriminatedUnion('granted', [
  z.object({ granted: z.literal(true), submittedVersion: z.string().min(1).max(100) }),
  z.object({ granted: z.literal(false), submittedVersion: z.string().min(1).max(100).nullable().optional() }),
])
export const resumeParseGateSchema = z.object({
  enabled: z.boolean(), legalVersion: z.string().min(1).max(100).nullable(), epoch: z.string().uuid(),
}).strict()

export type ResumeParsePatch = z.infer<typeof resumePatchSchema>
export type ConfirmResumeParseInput = z.input<typeof confirmResumeParseSchema>
export type RequestResumeParseInput = z.input<typeof requestResumeParseSchema>
export type ResumeParseConsentInput = z.input<typeof resumeParseConsentSchema>

export const resumeParseFailureCodeSchema = z.enum([
  'QUEUE_UNAVAILABLE', 'SOURCE_MISSING', 'SOURCE_CHANGED', 'PDF_INVALID', 'PDF_ENCRYPTED',
  'PDF_TOO_MANY_PAGES', 'PDF_NO_TEXT', 'PDF_LIMIT', 'EXTRACTION_TIMEOUT',
  'PROVIDER_TIMEOUT', 'PROVIDER_UNAVAILABLE', 'PROVIDER_REFUSAL', 'OUTPUT_TRUNCATED',
  'OUTPUT_INVALID', 'AUTHORIZATION_CHANGED', 'ATTEMPTS_EXHAUSTED',
])
export type ResumeParseFailureCode = z.infer<typeof resumeParseFailureCodeSchema>

function assertByteLimit(value: unknown): void {
  let serialized: string | undefined
  try { serialized = JSON.stringify(value) } catch { /* Non-JSON input fails below. */ }
  if (serialized === undefined || new TextEncoder().encode(serialized).byteLength > RESUME_SUGGESTION_MAX_BYTES) {
    throw new z.ZodError([{ code: 'custom', path: [], message: 'Invalid or oversized suggestion' }])
  }
}

function redactStrings(value: unknown): unknown {
  if (typeof value === 'string') return redact(value).trim()
  if (Array.isArray(value)) return value.map(redactStrings)
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, redactStrings(item)]))
  }
  return value
}

function usefulText(value: string | null): boolean {
  return value !== null && value.replaceAll(REDACTED, '').trim().length > 0
}

/** Full owner profile shape permits an empty profile; it is not a provider acceptance check. */
export function normalizeResumeProfileSnapshot(value: unknown): ResumeSuggestionV1 {
  assertByteLimit(value)
  const whitelisted = resumeSuggestionSchema.parse(value)
  const result = resumeSuggestionSchema.parse(redactStrings(whitelisted))
  assertByteLimit(result)
  return result
}

/** Provider boundary: whitelist, redact every string, normalize, validate, then require useful content. */
export function normalizeResumeSuggestion(value: unknown): ResumeSuggestionV1 {
  const result = normalizeResumeProfileSnapshot(value)
  if (!(usefulText(result.headline) || usefulText(result.summary) || result.skills.some(usefulText) ||
    result.languages.some(item => usefulText(item.language)) ||
    result.educations.some(item => usefulText(item.schoolName)) ||
    result.experiences.some(item => usefulText(item.title)))) {
    throw new z.ZodError([{ code: 'custom', path: [], message: 'No useful career suggestion' }])
  }
  return result
}

/** Owner confirmation may intentionally clear any selected group. */
export function normalizeResumeConfirmation(value: unknown): z.output<typeof confirmResumeParseSchema> {
  assertByteLimit(value)
  const whitelisted = confirmResumeParseSchema.parse(value)
  const result = confirmResumeParseSchema.parse({
    ...whitelisted, patch: redactStrings(whitelisted.patch),
  })
  assertByteLimit(result.patch)
  return result
}
