// 建档写端点（PUT /profile/basic、/preferences、/skills）的请求体。服务端用的是
// src/server/services/student-profile.ts 的 step1~3 schema（不在 @shared 里，App 引不到），
// 这里按同样的约束抄一份，只为了在提交前给出就地提示；最终以服务端校验为准。
// 建议把 step schema 挪进 src/shared/mobile-api，App 直接 import（见 MA2 报告）。
import { z } from 'zod'

export const WORK_AUTH = ['MY_CITIZEN', 'MY_PR', 'STUDENT_PASS', 'DEPENDANT_PASS', 'NEEDS_WORK_PASS', 'OTHER'] as const
export const DEGREE_LEVELS = ['FOUNDATION', 'DIPLOMA', 'BACHELOR', 'MASTER', 'PHD'] as const
export const LANGUAGE_LEVELS = ['BASIC', 'CONVERSATIONAL', 'FLUENT', 'NATIVE'] as const
export const JOB_TYPES = ['INTERNSHIP', 'FULL_TIME', 'PART_TIME'] as const

export type WorkAuth = (typeof WORK_AUTH)[number]
export type DegreeLevel = (typeof DEGREE_LEVELS)[number]
export type LanguageLevel = (typeof LANGUAGE_LEVELS)[number]
export type JobType = (typeof JOB_TYPES)[number]

export const basicInputSchema = z.object({
  fullName: z.string().trim().min(1).max(100),
  schoolId: z.string().min(1).max(64).nullable(),
  degreeLevel: z.enum(DEGREE_LEVELS).nullable(),
  major: z.string().max(100).nullable(),
  graduationYear: z.number().int().min(2000).max(2040).nullable(),
  graduationMonth: z.number().int().min(1).max(12).nullable(),
  cgpa: z.number().min(0).max(4).nullable(),
  nationality: z.string().length(2).nullable(),
  workAuth: z.enum(WORK_AUTH),
})
export type BasicInput = z.infer<typeof basicInputSchema>

export const preferencesInputSchema = z.object({
  intents: z.array(z.enum(JOB_TYPES)).min(1),
  // 到岗日期 App 首版不编辑：原样回传，避免整节替换时把 Web 上填的值清掉
  availableFrom: z.string().nullable(),
  preferredStates: z.array(z.string().max(10)).max(20),
  preferredIndustries: z.array(z.string().max(50)).max(20),
  expectedSalaryMin: z.number().int().nonnegative().nullable(),
  expectedSalaryMax: z.number().int().nonnegative().nullable(),
})
export type PreferencesInput = z.infer<typeof preferencesInputSchema>

export const skillsInputSchema = z.object({
  languages: z.array(z.object({ language: z.string().trim().min(1).max(20), level: z.enum(LANGUAGE_LEVELS) })).max(20),
  skills: z.array(z.string().trim().min(1).max(50)).max(30),
  headline: z.string().max(100).nullable(),
  summary: z.string().max(2000).nullable(),
})
export type SkillsInput = z.infer<typeof skillsInputSchema>

/** 文本框里的数字：空串是 null，非数字返回 NaN 交给 schema 报错 */
export function parseOptionalNumber(raw: string): number | null {
  const s = raw.trim()
  if (!s) return null
  const n = Number(s)
  return Number.isFinite(n) ? n : Number.NaN
}

export function emptyToNull(raw: string): string | null {
  const s = raw.trim()
  return s ? s : null
}
