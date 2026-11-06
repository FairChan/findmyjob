'use server'
import { action } from '@/server/action'
import {
  approveJob,
  approveJobSchema,
  rejectJob,
  rejectJobSchema,
} from '@/server/services/review-jobs'

export const approveJobAction = action(
  { auth: 'admin', input: approveJobSchema },
  async ctx => {
    return approveJob({ userId: ctx.userId! }, ctx.input)
  },
)

export const rejectJobAction = action(
  { auth: 'admin', input: rejectJobSchema },
  async ctx => {
    return rejectJob({ userId: ctx.userId! }, ctx.input)
  },
)
