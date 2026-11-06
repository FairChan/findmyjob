'use server'
import { z } from 'zod'
import { action } from '@/server/action'
import {
  inviteMember,
  inviteMemberSchema,
  removeMember,
  removeMemberSchema,
  changeRole,
  changeRoleSchema,
  acceptInvite,
} from '@/server/services/team'
import { createEmailProvider } from '@/lib/email'
import { env } from '@/env'
import { after } from 'next/server'

export const inviteMemberAction = action(
  {
    auth: { type: 'company', minRole: 'ADMIN' },
    input: inviteMemberSchema,
  },
  async ctx => {
    const { userId, companyId, companyRole, input } = ctx
    const result = await inviteMember(
      { userId: userId!, companyId: companyId!, role: companyRole! },
      input,
    )

    // Send invite email outside the response (fire-and-forget)
    const { token } = result
    const locale = 'zh'
    const acceptUrl = `${env.APP_URL}/${locale}/e/team/accept?token=${token}`
    after(async () => {
      try {
        const emailProvider = createEmailProvider()
        await emailProvider.sendEmail({
          to: input.email,
          subject: 'You have been invited to join a company on FindMYJob',
          html: `<p>You have been invited to join a company on FindMYJob as <b>${input.role}</b>.</p>
<p><a href="${acceptUrl}">Click here to accept the invitation</a></p>
<p>This link expires in 7 days.</p>`,
          text: `You have been invited to join a company on FindMYJob as ${input.role}.\n\nAccept: ${acceptUrl}\n\nThis link expires in 7 days.`,
        })
      } catch {
        // email failure is non-fatal
      }
    })

    return {}
  },
)

export const acceptInviteAction = action(
  {
    auth: 'user',
    input: z.object({ token: z.string().min(1).max(512) }),
  },
  async ctx => {
    const { userId, input } = ctx
    await acceptInvite({ userId: userId! }, input.token)
    return {}
  },
)

export const removeMemberAction = action(
  {
    auth: { type: 'company', minRole: 'ADMIN' },
    input: removeMemberSchema,
  },
  async ctx => {
    const { userId, companyId, companyRole, input } = ctx
    await removeMember(
      { userId: userId!, companyId: companyId!, role: companyRole! },
      input,
    )
    return {}
  },
)

export const changeRoleAction = action(
  {
    auth: { type: 'company', minRole: 'OWNER' },
    input: changeRoleSchema,
  },
  async ctx => {
    const { userId, companyId, companyRole, input } = ctx
    await changeRole(
      { userId: userId!, companyId: companyId!, role: companyRole! },
      input,
    )
    return {}
  },
)
