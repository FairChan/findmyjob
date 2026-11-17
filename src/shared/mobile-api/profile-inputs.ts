// 建档四节（基本信息、求职意向、技能与语言、教育与经历）的请求 schema。
// 原来在 src/server/services/student-profile.ts，MA1-T08 原样挪到这里，Web 服务端和 App 共用同一份；
// student-profile.ts 从这里 re-export，语义一字不变。改这里就等于改 Web 的校验。
import { z } from 'zod'

// 与 Prisma 枚举（以及 server/schemas/resume-parsing.ts 的同名枚举）一致；
// tests/unit/profile-inputs-shared.test.ts 守着两边不走样
export const degreeLevelSchema = z.enum(['FOUNDATION', 'DIPLOMA', 'BACHELOR', 'MASTER', 'PHD'])
export const languageLevelSchema = z.enum(['BASIC', 'CONVERSATIONAL', 'FLUENT', 'NATIVE'])
export const experienceKindSchema = z.enum(['INTERNSHIP', 'WORK', 'PROJECT', 'CAMPUS', 'AWARD'])
export const workAuthSchema = z.enum([
  'MY_CITIZEN',
  'MY_PR',
  'STUDENT_PASS',
  'DEPENDANT_PASS',
  'NEEDS_WORK_PASS',
  'OTHER',
])
export const jobTypeSchema = z.enum(['INTERNSHIP', 'FULL_TIME', 'PART_TIME'])

export const step1Schema = z.object({
  fullName: z.string().min(1).max(100),
  schoolId: z.string().min(1).max(64).nullable().optional(),
  degreeLevel: degreeLevelSchema.nullable().optional(),
  major: z.string().max(100).nullable().optional(),
  graduationYear: z.number().int().min(2000).max(2040).nullable().optional(),
  graduationMonth: z.number().int().min(1).max(12).nullable().optional(),
  cgpa: z.number().min(0).max(4).nullable().optional(),
  nationality: z.string().length(2).toUpperCase().nullable().optional(),
  workAuth: workAuthSchema,
})

export const step2Schema = z.object({
  intents: z.array(jobTypeSchema).min(1),
  availableFrom: z.string().datetime({ offset: true }).nullable().optional(),
  preferredStates: z.array(z.string().max(10)).max(20).optional(),
  preferredIndustries: z.array(z.string().max(50)).max(20).optional(),
  expectedSalaryMin: z.number().int().nonnegative().nullable().optional(),
  expectedSalaryMax: z.number().int().nonnegative().nullable().optional(),
})

const languageEntrySchema = z.object({
  language: z.string().min(1).max(20),
  level: languageLevelSchema,
})

export const step3Schema = z.object({
  languages: z.array(languageEntrySchema).max(20),
  skills: z.array(z.string().min(1).max(50)).max(30),
  headline: z.string().max(100).nullable().optional(),
  summary: z.string().max(2000).nullable().optional(),
})

const educationEntrySchema = z.object({
  schoolName: z.string().min(1).max(200),
  degreeLevel: degreeLevelSchema.nullable().optional(),
  major: z.string().max(100).nullable().optional(),
  startDate: z.string().datetime({ offset: true }).nullable().optional(),
  endDate: z.string().datetime({ offset: true }).nullable().optional(),
  gpa: z.string().max(20).nullable().optional(),
  description: z.string().max(1000).nullable().optional(),
  sortOrder: z.number().int().nonnegative().optional(),
})

const experienceEntrySchema = z.object({
  kind: experienceKindSchema,
  title: z.string().min(1).max(200),
  organization: z.string().max(200).nullable().optional(),
  startDate: z.string().datetime({ offset: true }).nullable().optional(),
  endDate: z.string().datetime({ offset: true }).nullable().optional(),
  description: z.string().max(1000).nullable().optional(),
  sortOrder: z.number().int().nonnegative().optional(),
})

export const step4Schema = z.object({
  educations: z.array(educationEntrySchema).max(20),
  experiences: z.array(experienceEntrySchema).max(50),
})

export type Step1Data = z.infer<typeof step1Schema>
export type Step2Data = z.infer<typeof step2Schema>
export type Step3Data = z.infer<typeof step3Schema>
export type Step4Data = z.infer<typeof step4Schema>
