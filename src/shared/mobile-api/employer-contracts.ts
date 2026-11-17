// /api/m/v1/e/* 企业端的请求与响应约定（MA4-T01）。规则同其他契约：字段只能加。
// 学生数据只来自服务端 talent-card 序列化器的输出：未解锁时 name 是打码名、自由文本已 redact，
// 不含联系方式和简历；这里的 schema 再 parse 一遍，多出来的字段会被丢掉。
import { z } from 'zod'
import { applicationStatusSchema } from './student-contracts'

const isoDate = z.string()
const cuid = z.string().cuid()

// ---- 学生卡片（talent-card 序列化结果） ----

export const mobileTalentCardSchema = z.object({
  id: z.string(),
  /** 未解锁时是打码后的名字 */
  name: z.string(),
  unlocked: z.boolean(),
  school: z.object({ id: z.string(), nameZh: z.string(), nameEn: z.string() }).nullable(),
  major: z.string().nullable(),
  degreeLevel: z.string().nullable(),
  graduationYear: z.number().int().nullable(),
  cgpa: z.string().nullable(),
  skills: z.array(z.string()),
  headline: z.string().nullable(),
  completeness: z.number().int(),
  workAuth: z.string().nullable(),
  lastActiveAt: isoDate.nullable(),
})
export type MobileTalentCard = z.infer<typeof mobileTalentCardSchema>

const datedEntry = { startDate: isoDate.nullable(), endDate: isoDate.nullable(), description: z.string().nullable(), sortOrder: z.number().int() }

export const mobileTalentDetailSchema = mobileTalentCardSchema.extend({
  summary: z.string().nullable(),
  educations: z.array(z.object({ id: z.string(), schoolName: z.string(), major: z.string().nullable(), degreeLevel: z.string().nullable(), ...datedEntry })),
  experiences: z.array(z.object({ id: z.string(), kind: z.string(), title: z.string(), organization: z.string().nullable(), ...datedEntry })),
  resumeCount: z.number().int(),
  /** 只有解锁后才有；未解锁恒为空数组 */
  resumeIds: z.array(z.string()),
  /** 只有解锁后、且经 contact-access 读出时才有；否则 null */
  contact: z
    .object({
      phone: z.string().nullable(),
      email: z.string().nullable(),
      whatsapp: z.string().nullable(),
      wechat: z.string().nullable(),
      linkedinUrl: z.string().nullable(),
    })
    .nullable(),
})
export type MobileTalentDetail = z.infer<typeof mobileTalentDetailSchema>

// ---- 职位 ----

export const mobileEmployerJobListSchema = z.object({
  items: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      type: z.string(),
      category: z.string().nullable(),
      status: z.enum(['DRAFT', 'PENDING_REVIEW', 'PUBLISHED', 'CLOSED', 'REJECTED']),
      state: z.string().nullable(),
      city: z.string().nullable(),
      workMode: z.string(),
      salaryMin: z.number().int().nullable(),
      salaryMax: z.number().int().nullable(),
      salaryVisible: z.boolean(),
      publishedAt: isoDate.nullable(),
      closedAt: isoDate.nullable(),
      deadline: isoDate.nullable(),
      createdAt: isoDate,
      applicationCount: z.number().int(),
    }),
  ),
})
export type MobileEmployerJobList = z.infer<typeof mobileEmployerJobListSchema>

export const mobileEmployerJobStatusSchema = z.object({ id: z.string(), status: z.string() })

// ---- 候选人 ----

export const mobileApplicantListSchema = z.object({
  jobTitle: z.string(),
  items: z.array(
    z.object({
      applicationId: z.string(),
      status: applicationStatusSchema,
      /** 未解锁时已 redact、去掉了学生姓名 */
      coverNote: z.string().nullable(),
      /** 企业自己的内部备注，学生看不到 */
      companyNote: z.string().nullable(),
      createdAt: isoDate,
      updatedAt: isoDate,
      card: mobileTalentCardSchema,
      graduationMonth: z.number().int().nullable(),
      languages: z.array(z.string()),
      internshipCount: z.number().int(),
      campusCount: z.number().int(),
    }),
  ),
})
export type MobileApplicantList = z.infer<typeof mobileApplicantListSchema>

export const mobileApplicantDetailSchema = z.object({
  applicationId: z.string(),
  status: applicationStatusSchema,
  coverNote: z.string().nullable(),
  companyNote: z.string().nullable(),
  createdAt: isoDate,
  profile: mobileTalentDetailSchema,
})
export type MobileApplicantDetail = z.infer<typeof mobileApplicantDetailSchema>

// ---- 邀请 ----

export const mobileCompanyInvitationListSchema = z.object({
  usage: z.object({ used: z.number().int(), quota: z.number().int().nullable() }),
  items: z.array(
    z.object({
      id: z.string(),
      status: z.enum(['SENT', 'ACCEPTED', 'DECLINED', 'EXPIRED']),
      message: z.string().nullable(),
      expiresAt: isoDate,
      createdAt: isoDate,
      respondedAt: isoDate.nullable(),
      applicationId: z.string().nullable(),
      job: z.object({ id: z.string(), title: z.string() }).nullable(),
      student: mobileTalentCardSchema,
    }),
  ),
})
export type MobileCompanyInvitationList = z.infer<typeof mobileCompanyInvitationListSchema>

export const mobileSendInvitationResultSchema = z.object({ invitationId: z.string(), alreadyExists: z.boolean() })

// ---- 人才库 ----

export const mobileTalentPageSchema = z.object({
  items: z.array(mobileTalentCardSchema),
  total: z.number().int(),
  /** 下一页的游标（就是页码），超过 talentSearch.maxPage 或没有更多时为 null */
  nextCursor: z.string().nullable(),
  maxPage: z.number().int(),
})
export type MobileTalentPage = z.infer<typeof mobileTalentPageSchema>

export const mobileTalentViewSchema = z.object({
  detail: mobileTalentDetailSchema,
  unlock: z.object({ enabled: z.boolean(), costCredits: z.number().int() }),
})
export type MobileTalentView = z.infer<typeof mobileTalentViewSchema>

export const mobileUnlockResultSchema = z.object({
  unlockId: z.string(),
  alreadyUnlocked: z.boolean(),
  balance: z.number().int().nullable(),
})

export const mobileWalletSchema = z.object({
  /** 企业未认证时为 null（与 Web 工作台一致）；App 里只读，不出现任何购买入口 */
  balance: z.number().int().nullable(),
})

// ---- 请求 ----

const DEGREE = ['FOUNDATION', 'DIPLOMA', 'BACHELOR', 'MASTER', 'PHD'] as const
const JOB_TYPES = ['INTERNSHIP', 'FULL_TIME', 'PART_TIME'] as const
const WORK_AUTH = ['MY_CITIZEN', 'MY_PR', 'STUDENT_PASS', 'DEPENDANT_PASS', 'NEEDS_WORK_PASS', 'OTHER'] as const
const csvOf = <T extends readonly [string, ...string[]]>(values: T) =>
  z
    .string()
    .max(200)
    .refine((raw) => raw.split(',').every((v) => (values as readonly string[]).includes(v)))

/** 与 Web /e/talent 的筛选项一致；intents、workAuths 是逗号分隔；cursor 是页码 */
export const mobileTalentQuerySchema = z
  .object({
    cursor: z.string().regex(/^[1-9]\d{0,3}$/).optional(),
    keyword: z.string().trim().max(100).optional(),
    sort: z.enum(['lastActive', 'completeness', 'graduationYear']).optional(),
    schoolId: z.string().min(1).max(64).optional(),
    degreeLevel: z.enum(DEGREE).optional(),
    gradFrom: z.coerce.number().int().min(1990).max(2100).optional(),
    gradTo: z.coerce.number().int().min(1990).max(2100).optional(),
    intents: csvOf(JOB_TYPES).optional(),
    workAuths: csvOf(WORK_AUTH).optional(),
  })
  .strict()
export type MobileTalentQuery = z.infer<typeof mobileTalentQuerySchema>

export const mobileChangeApplicationStatusSchema = z
  .object({
    toStatus: applicationStatusSchema,
    note: z.string().max(2000).nullable().optional(),
  })
  .strict()

export const mobileSendInvitationSchema = z
  .object({
    studentId: cuid,
    jobId: cuid,
    message: z.string().max(500).trim().nullable().optional(),
  })
  .strict()
