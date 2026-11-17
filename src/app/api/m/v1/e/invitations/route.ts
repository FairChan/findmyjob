import type { z } from 'zod'
import { route } from '@/server/route'
import { COMPANY_MEMBER, VERIFIED_COMPANY_MEMBER, companyCtxOf, mobileOk } from '@/server/lib/mobile-api'
import { listMobileCompanyInvitations } from '@/server/services/mobile-employer'
import { sendInvitation } from '@/server/services/invitations'
import { mobileCompanyInvitationListSchema, mobileSendInvitationResultSchema, mobileSendInvitationSchema } from '@/shared/mobile-api'

// 本公司发出的邀请（学生已不可见的会被过滤掉）和本月用量
export const GET = route({ auth: COMPANY_MEMBER, origin: 'app' }, async (_req, ctx) => {
  return mobileOk(mobileCompanyInvitationListSchema, await listMobileCompanyInvitations(companyCtxOf(ctx)))
})

// 发邀请：与 Web sendInvitationAction 同一个 service（须已认证；按 KL 自然月计额度，超额 429；同一职位未过期的邀请幂等返回）
export const POST = route({ auth: VERIFIED_COMPANY_MEMBER, origin: 'app', input: mobileSendInvitationSchema }, async (_req, ctx) => {
  const input = ctx.input as z.infer<typeof mobileSendInvitationSchema>
  return mobileOk(mobileSendInvitationResultSchema, await sendInvitation(companyCtxOf(ctx), input))
})
