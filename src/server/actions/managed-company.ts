'use server'
import { z } from 'zod'
import { action } from '@/server/action'
import { transferCompany, transferInputSchema } from '@/server/services/managed-company'
import { createEmailProvider } from '@/lib/email'
import { env } from '@/env'
import { logger } from '@/server/lib/logger'
import { after } from 'next/server'

export const transferManagedCompanyAction = action(
  {
    auth: 'admin',
    input: z.object({
      companyId: z.string().cuid(),
      transfer: transferInputSchema,
    }),
  },
  async ctx => {
    const { userId, input } = ctx
    const result = await transferCompany({ userId: userId! }, input.companyId, input.transfer)
    // Send the accept link to the new owner — token must NOT be returned to the client
    const { token } = result
    const locale = 'zh'
    const acceptUrl = `${env.APP_URL}/${locale}/e/team/accept?token=${token}`
    after(async () => {
      try {
        const emailProvider = createEmailProvider()
        await emailProvider.sendEmail({
          to: input.transfer.ownerEmail,
          subject: 'FindMYJob 企业移交邀请 / Company transfer invitation',
          html: `<p>您已被指定为 FindMYJob 平台上一家企业的新负责人。</p>
<p><a href="${acceptUrl}">点击此处接受移交</a></p>
<p>链接 7 天内有效。</p>`,
          text: `您已被指定为 FindMYJob 平台上一家企业的新负责人。\n\n接受链接：${acceptUrl}\n\n链接 7 天内有效。`,
        })
      } catch (err) {
        const e = err as Record<string, unknown>
        logger.error(
          { errName: typeof e?.name === 'string' ? e.name : undefined, code: e?.code },
          'transferManagedCompanyAction: email send failed',
        )
      }
    })
    return {}
  },
)
