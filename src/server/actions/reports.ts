'use server'

import { action } from '@/server/action'
import { createReport, createReportSchema } from '@/server/services/reports'

export const createReportAction = action(
  { auth: 'user', input: createReportSchema },
  async ctx => createReport({ userId: ctx.userId! }, ctx.input),
)
