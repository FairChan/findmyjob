import type { z } from 'zod'
import { route } from '@/server/route'
import { mobileOk } from '@/server/lib/mobile-api'
import { listMobileApplications } from '@/server/services/mobile-student'
import { applyToJob } from '@/server/services/applications'
import { mobileApplicationListSchema, mobileApplicationRefSchema, mobileApplySchema } from '@/shared/mobile-api'

export const GET = route({ auth: 'student', origin: 'app' }, async (_req, ctx) => {
  return mobileOk(mobileApplicationListSchema, await listMobileApplications({ userId: ctx.userId! }))
})

// 投递：完成度、联系方式和简历、"先看过才能投"（防绕额度）都在 applyToJob 里判断，与 Web 投递弹窗同一条路径
export const POST = route({ auth: 'student', origin: 'app', input: mobileApplySchema }, async (_req, ctx) => {
  const input = ctx.input as z.infer<typeof mobileApplySchema>
  return mobileOk(mobileApplicationRefSchema, await applyToJob({ userId: ctx.userId! }, input))
})
