// /api/m/v1 学生端的响应约定（MA1-T04/T05）。规则同 contracts.ts：字段只能加，不能删或改语义。
// 时间一律是 ISO 8601 字符串（UTC），App 按 Asia/Kuala_Lumpur 展示。
// 字段只放 Web 学生端页面本来就展示给学生看的内容；隐藏薪资在服务端已经置成 null。
// 服务端在返回前用这些 schema 再 parse 一遍：z.object 默认丢弃多余字段，多一层防泄漏。
import { z } from 'zod'

const isoDate = z.string()
const jobTypeSchema = z.enum(['INTERNSHIP', 'FULL_TIME', 'PART_TIME'])
const workModeSchema = z.enum(['ONSITE', 'HYBRID', 'REMOTE'])
export const applicationStatusSchema = z.enum([
  'APPLIED', 'VIEWED', 'SHORTLISTED', 'INTERVIEW', 'OFFER', 'HIRED', 'REJECTED', 'WITHDRAWN',
])

/** 不带 payload 的空成功体，写端点统一返回它 */
export const mobileEmptySchema = z.object({})

export const mobileCompanyRefSchema = z.object({
  id: z.string(),
  legalName: z.string(),
  displayNameZh: z.string().nullable(),
  displayNameEn: z.string().nullable(),
})

export const mobileJobListItemSchema = z.object({
  id: z.string(),
  title: z.string(),
  type: jobTypeSchema,
  category: z.string().nullable(),
  workMode: workModeSchema,
  state: z.string().nullable(),
  city: z.string().nullable(),
  salaryMin: z.number().int().nullable(),
  salaryMax: z.number().int().nullable(),
  languages: z.array(z.string()),
  skills: z.array(z.string()),
  acceptsStudentPass: z.boolean(),
  sponsorsWorkPass: z.boolean(),
  headcount: z.number().int().nullable(),
  deadline: isoDate.nullable(),
  publishedAt: isoDate.nullable(),
  company: mobileCompanyRefSchema,
})
export type MobileJobListItem = z.infer<typeof mobileJobListItemSchema>

export const mobileJobPageSchema = z.object({
  items: z.array(mobileJobListItemSchema),
  nextCursor: z.string().nullable(),
})
export type MobileJobPage = z.infer<typeof mobileJobPageSchema>

export const mobileQuotaSchema = z.object({
  used: z.number().int(),
  /** null 表示不限 */
  limit: z.number().int().nullable(),
  /** 距离下一档还差几个有效邀请；已经不限时为 0 */
  next: z.number().int(),
  qualified: z.number().int(),
})
export type MobileQuota = z.infer<typeof mobileQuotaSchema>

/** GET /jobs/:id/preview：只有列表级字段，不产生 JobView、不扣额度 */
export const mobileJobPreviewSchema = z.object({
  job: mobileJobListItemSchema,
  /** true 表示 open 这个职位不会再扣额度（看过、投过、被邀请过，或额度不限） */
  opensFree: z.boolean(),
  quota: mobileQuotaSchema,
})
export type MobileJobPreview = z.infer<typeof mobileJobPreviewSchema>

export const mobileJobDetailSchema = mobileJobListItemSchema.extend({
  description: z.string(),
  requirements: z.string().nullable(),
  benefits: z.string().nullable(),
})
export type MobileJobDetail = z.infer<typeof mobileJobDetailSchema>

export const mobileApplyBlockerSchema = z.enum(['contactAndResume', 'contact', 'resume', 'profile'])

/** POST /jobs/:id/open：唯一会扣额度的端点。allowed=false 时 detail 为 null（额度用完，对应 Web 的锁定卡片） */
export const mobileJobOpenSchema = z.object({
  allowed: z.boolean(),
  quota: mobileQuotaSchema,
  job: mobileJobListItemSchema,
  detail: mobileJobDetailSchema.nullable(),
  application: z
    .object({ id: z.string(), status: applicationStatusSchema, canWithdraw: z.boolean() })
    .nullable(),
  applyBlocker: mobileApplyBlockerSchema.nullable(),
  resumes: z.array(z.object({ id: z.string(), fileName: z.string(), isPrimary: z.boolean() })),
})
export type MobileJobOpen = z.infer<typeof mobileJobOpenSchema>

export const mobileProfileSchema = z.object({
  fullName: z.string(),
  schoolId: z.string().nullable(),
  degreeLevel: z.string().nullable(),
  major: z.string().nullable(),
  graduationYear: z.number().int().nullable(),
  graduationMonth: z.number().int().nullable(),
  cgpa: z.number().nullable(),
  nationality: z.string().nullable(),
  workAuth: z.string().nullable(),
  intents: z.array(z.string()),
  availableFrom: isoDate.nullable(),
  preferredStates: z.array(z.string()),
  preferredIndustries: z.array(z.string()),
  expectedSalaryMin: z.number().int().nullable(),
  expectedSalaryMax: z.number().int().nullable(),
  skills: z.array(z.string()),
  headline: z.string().nullable(),
  summary: z.string().nullable(),
  onboardingStep: z.number().int(),
  languages: z.array(z.object({ language: z.string(), level: z.string() })),
  educations: z.array(
    z.object({
      id: z.string(),
      schoolName: z.string(),
      degreeLevel: z.string().nullable(),
      major: z.string().nullable(),
      startDate: isoDate.nullable(),
      endDate: isoDate.nullable(),
      gpa: z.string().nullable(),
      description: z.string().nullable(),
      sortOrder: z.number().int(),
    }),
  ),
  experiences: z.array(
    z.object({
      id: z.string(),
      kind: z.string(),
      title: z.string(),
      organization: z.string().nullable(),
      startDate: isoDate.nullable(),
      endDate: isoDate.nullable(),
      description: z.string().nullable(),
      sortOrder: z.number().int(),
    }),
  ),
})
export type MobileProfile = z.infer<typeof mobileProfileSchema>

/** GET /profile/completeness：与 Web 档案页的完成度卡片和待办一致 */
export const mobileProfileCompletenessSchema = z.object({
  completeness: z.number().int(),
  schoolVerified: z.boolean(),
  hasResume: z.boolean(),
  hasContact: z.boolean(),
  talentPoolEnabled: z.boolean(),
})
export type MobileProfileCompleteness = z.infer<typeof mobileProfileCompletenessSchema>

export const mobileSchoolListSchema = z.object({
  items: z.array(
    z.object({ id: z.string(), nameZh: z.string(), nameEn: z.string(), emailDomains: z.array(z.string()) }),
  ),
})
export type MobileSchoolList = z.infer<typeof mobileSchoolListSchema>

export const mobileCompanyListItemSchema = mobileCompanyRefSchema.extend({
  hasLogo: z.boolean(),
  state: z.string().nullable(),
  city: z.string().nullable(),
  publishedJobCount: z.number().int(),
})
export const mobileCompanyPageSchema = z.object({
  items: z.array(mobileCompanyListItemSchema),
  nextCursor: z.string().nullable(),
})
export type MobileCompanyPage = z.infer<typeof mobileCompanyPageSchema>

export const mobileCompanyJobSchema = z.object({
  id: z.string(),
  title: z.string(),
  type: jobTypeSchema,
  workMode: workModeSchema,
  state: z.string().nullable(),
  city: z.string().nullable(),
  salaryMin: z.number().int().nullable(),
  salaryMax: z.number().int().nullable(),
  acceptsStudentPass: z.boolean(),
  sponsorsWorkPass: z.boolean(),
})

export const mobileCompanyDetailSchema = z.object({
  company: mobileCompanyRefSchema.extend({
    description: z.string().nullable(),
    /** 只放 http(s) 地址；不合法的历史数据返回 null */
    website: z.string().nullable(),
    hasLogo: z.boolean(),
    state: z.string().nullable(),
    city: z.string().nullable(),
    industryCode: z.string().nullable(),
    size: z.string().nullable(),
    isFoundingPartner: z.boolean(),
  }),
  jobs: z.object({ items: z.array(mobileCompanyJobSchema), nextCursor: z.string().nullable() }),
})
export type MobileCompanyDetail = z.infer<typeof mobileCompanyDetailSchema>

/** 通知只给类型和时间（Web 通知页也不展示 payload）；文案由 App 按 type 映射 */
export const mobileNotificationPageSchema = z.object({
  items: z.array(
    z.object({ id: z.string(), type: z.string(), readAt: isoDate.nullable(), createdAt: isoDate }),
  ),
  nextCursor: z.string().nullable(),
  unreadCount: z.number().int(),
})
export type MobileNotificationPage = z.infer<typeof mobileNotificationPageSchema>

export const mobileApplicationEventSchema = z.object({
  id: z.string(),
  fromStatus: applicationStatusSchema.nullable(),
  toStatus: applicationStatusSchema,
  createdAt: isoDate,
})

export const mobileApplicationListSchema = z.object({
  items: z.array(
    z.object({
      id: z.string(),
      status: applicationStatusSchema,
      coverNote: z.string().nullable(),
      createdAt: isoDate,
      canWithdraw: z.boolean(),
      job: z.object({ id: z.string(), title: z.string(), companyName: z.string() }),
    }),
  ),
  nextCursor: z.string().nullable(),
})
export type MobileApplicationList = z.infer<typeof mobileApplicationListSchema>

/** 公司的内部备注（ApplicationEvent.note）和操作人永远不给学生 */
export const mobileApplicationTimelineSchema = z.object({ events: z.array(mobileApplicationEventSchema) })
export type MobileApplicationTimeline = z.infer<typeof mobileApplicationTimelineSchema>

export const mobileInvitationListSchema = z.object({
  items: z.array(
    z.object({
      id: z.string(),
      status: z.enum(['SENT', 'ACCEPTED', 'DECLINED', 'EXPIRED']),
      message: z.string().nullable(),
      expiresAt: isoDate,
      createdAt: isoDate,
      respondedAt: isoDate.nullable(),
      applicationId: z.string().nullable(),
      job: z
        .object({
          id: z.string(),
          title: z.string(),
          type: z.string(),
          workMode: z.string().nullable(),
          city: z.string().nullable(),
          salaryMin: z.number().int().nullable(),
          salaryMax: z.number().int().nullable(),
        })
        .nullable(),
      company: mobileCompanyRefSchema,
    }),
  ),
  nextCursor: z.string().nullable(),
})
export type MobileInvitationList = z.infer<typeof mobileInvitationListSchema>

/** 邀请同学：被邀请人只给打码后的名字和完成度（与 Web 邀请页一致） */
export const mobileReferralsSchema = z.object({
  code: z.string(),
  inviteLink: z.string(),
  quota: mobileQuotaSchema,
  tierSize: z.number().int(),
  tierBonus: z.number().int(),
  unlimitedAt: z.number().int(),
  referrals: z.array(
    z.object({
      id: z.string(),
      status: z.enum(['PENDING', 'QUALIFIED', 'VOID']),
      inviteeName: z.string().nullable(),
      inviteeCompleteness: z.number().int().nullable(),
    }),
  ),
})
export type MobileReferrals = z.infer<typeof mobileReferralsSchema>
