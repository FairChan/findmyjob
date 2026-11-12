'use server'

import { action } from '@/server/action'
import { resolveReport, resolveReportSchema } from '@/server/services/reports'

export const resolveReportAction = action(
  { auth: 'admin', input: resolveReportSchema },
  async ctx => resolveReport({ userId: ctx.userId! }, ctx.input),
)
