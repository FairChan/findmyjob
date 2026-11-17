// /api/m/v1 学生端新增端点的请求 schema（纯 zod，App 可以直接拿来校验表单和拼查询串）。
// 建档写端点复用服务端 student-profile 的 step1~4 schema，不在这里重复。
// 查询串里的值都是字符串，数字要用 coerce；多余的参数一律 400（strict），免得 App 拼错了却悄悄生效。
import { z } from 'zod'

const cuid = z.string().cuid()

export const COMPANY_TAGS = [
  'FORTUNE_500', 'MULTINATIONAL', 'MY_LEADING', 'CN_OVERSEAS', 'SOE', 'ALUMNI', 'CHINESE_MY',
] as const
export const companyTagSchema = z.enum(COMPANY_TAGS)

/** 与 Web /s/jobs 的筛选参数一致；tags 是逗号分隔的 CompanyTag */
export const mobileJobsQuerySchema = z
  .object({
    q: z.string().trim().max(100).optional(),
    type: z.enum(['INTERNSHIP', 'FULL_TIME', 'PART_TIME']).optional(),
    state: z.string().max(10).optional(),
    workMode: z.enum(['ONSITE', 'HYBRID', 'REMOTE']).optional(),
    sort: z.enum(['relevance', 'salary']).optional(),
    cursor: z.string().min(1).max(64).optional(),
    industry: z.string().max(50).optional(),
    tags: z
      .string()
      .max(200)
      .refine((raw) => raw.split(',').every((t) => (COMPANY_TAGS as readonly string[]).includes(t)))
      .optional(),
    size: z.enum(['S1_10', 'S11_50', 'S51_200', 'S201_1000', 'S1000_PLUS']).optional(),
    salary: z.coerce.number().int().min(1).max(1_000_000).optional(),
  })
  .strict()
export type MobileJobsQuery = z.infer<typeof mobileJobsQuerySchema>

export const mobileCompaniesQuerySchema = z
  .object({ tag: companyTagSchema.optional(), cursor: cuid.optional() })
  .strict()

export const mobileCompanyDetailQuerySchema = z.object({ jobsCursor: cuid.optional() }).strict()

export const mobileCursorQuerySchema = z.object({ cursor: cuid.optional() }).strict()

/** 已读：要么给一批 id（最多 50 条，和 Web 一致），要么 all=true */
export const mobileNotificationsReadSchema = z.union([
  z.object({ ids: z.array(cuid).min(1).max(50) }).strict(),
  z.object({ all: z.literal(true) }).strict(),
])

export const mobileApplySchema = z
  .object({
    jobId: cuid,
    resumeId: cuid.nullable().optional(),
    coverNote: z.string().max(500).nullable().optional(),
  })
  .strict()

export const mobileLocaleSchema = z.object({ locale: z.enum(['zh', 'en']) }).strict()

export const mobileVisibilitySchema = z.object({ granted: z.boolean() }).strict()

export const mobileBlockCompanySchema = z.object({ companyId: cuid }).strict()

export const mobileCompanySearchQuerySchema = z.object({ query: z.string().trim().min(1).max(100) }).strict()

export const mobileEmptyInputSchema = z.object({}).strict()

/** 注销是不可逆操作：App 必须显式带 confirm=true，误调用直接 400 */
export const mobileAccountDeleteSchema = z.object({ confirm: z.literal(true) }).strict()

export const mobileReconsentSchema = z
  .object({ agreed: z.literal(true), version: z.string().min(1).max(100) })
  .strict()
