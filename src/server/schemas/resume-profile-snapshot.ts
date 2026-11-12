import { z } from 'zod'
import {
  resumeDegreeLevelSchema, resumeLanguageLevelSchema, resumeExperienceKindSchema,
} from './resume-parsing'

// Owner-only comparison data. Mirror the existing manual field bounds without
// AI acceptance rules: no trim/deduplication, date-order repair or useful-text test.
// Never use this schema for provider output, READY publication or confirmation.
const date = z.string().datetime({ offset: true }).max(40).nullable()
const profileSnapshotSchema = z.object({
  headline: z.string().max(100).nullable(),
  summary: z.string().max(2000).nullable(),
  skills: z.array(z.string().min(1).max(50)).max(30),
  languages: z.array(z.object({
    language: z.string().min(1).max(20), level: resumeLanguageLevelSchema,
  })).max(20),
  educations: z.array(z.object({
    schoolName: z.string().min(1).max(200), degreeLevel: resumeDegreeLevelSchema.nullable(),
    major: z.string().max(100).nullable(), startDate: date, endDate: date,
    gpa: z.string().max(20).nullable(), description: z.string().max(1000).nullable(),
  })).max(20),
  experiences: z.array(z.object({
    kind: resumeExperienceKindSchema, title: z.string().min(1).max(200),
    organization: z.string().max(200).nullable(), startDate: date, endDate: date,
    description: z.string().max(1000).nullable(),
  })).max(50),
})
export type ExistingResumeProfileSnapshot = z.infer<typeof profileSnapshotSchema>

export function projectExistingResumeProfile(value: unknown): ExistingResumeProfileSnapshot {
  // Parse/strip first so unknown properties cannot escape the explicit owner DTO.
  const result = profileSnapshotSchema.parse(value)
  // Separate from the 128-KiB model budget. Existing manual maxima can exceed it;
  // 1 MiB also accommodates JSON escaping of all bounded historical string fields.
  if (new TextEncoder().encode(JSON.stringify(result)).byteLength > 1024 * 1024) {
    throw new z.ZodError([{ code: 'custom', path: [], message: 'Existing profile snapshot exceeds size limit' }])
  }
  return result
}
