import type { z } from 'zod'
import { route } from '@/server/route'
import { VERIFIED_COMPANY_MEMBER, companyCtxOf, mobileOk, pathIdAfter } from '@/server/lib/mobile-api'
import { changeApplicationStatus } from '@/server/services/applicants'
import { mobileChangeApplicationStatusSchema, mobileEmptySchema } from '@/shared/mobile-api'

// 与 Web 看板的 changeStatusAction 同一个 service：企业不能设 APPLIED 或 WITHDRAWN，已撤回的不能改，
// 被同时改过返回 409，写 ApplicationEvent，并给学生发站内通知和邮件（都不含企业备注）
export const POST = route({ auth: VERIFIED_COMPANY_MEMBER, origin: 'app', input: mobileChangeApplicationStatusSchema }, async (req, ctx) => {
  const input = ctx.input as z.infer<typeof mobileChangeApplicationStatusSchema>
  await changeApplicationStatus(companyCtxOf(ctx), { applicationId: pathIdAfter(req, 'applications'), ...input })
  return mobileOk(mobileEmptySchema, {})
})
