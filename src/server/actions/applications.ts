'use server'
import { z } from 'zod'
import { action } from '@/server/action'
import { applyToJob, withdrawApplication } from '@/server/services/applications'

const applyInputSchema = z.object({
  jobId: z.string().cuid(),
  resumeId: z.string().cuid().nullable().optional(),
  coverNote: z.string().max(500).nullable().optional(),
})

const withdrawInputSchema = z.object({
  applicationId: z.string().cuid(),
})

export const applyToJobAction = action(
  { auth: 'student', input: applyInputSchema },
  async ({ userId, input }) => {
    return applyToJob({ userId: userId! }, input)
  },
)

export const withdrawApplicationAction = action(
  { auth: 'student', input: withdrawInputSchema },
  async ({ userId, input }) => {
    return withdrawApplication({ userId: userId! }, input)
  },
)
