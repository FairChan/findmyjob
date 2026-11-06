'use server'
import { z } from 'zod'
import { getTranslations } from 'next-intl/server'
import { action } from '@/server/action'
import {
  jobFormSchema,
  createJob,
  updateJob,
  copyJob,
  closeJob,
} from '@/server/services/jobs'

export const createJobAction = action(
  {
    auth: { type: 'company', minRole: 'RECRUITER' },
    input: jobFormSchema,
  },
  async ({ companyId, userId, companyRole, input }) => {
    const ctx = { userId: userId!, companyId: companyId!, role: companyRole! }
    const job = await createJob(ctx, input)
    return { id: job.id, status: job.status }
  },
)

const updateJobInput = jobFormSchema.extend({ jobId: z.string().cuid() })

export const updateJobAction = action(
  {
    auth: { type: 'company', minRole: 'RECRUITER' },
    input: updateJobInput,
  },
  async ({ companyId, userId, companyRole, input }) => {
    const { jobId, ...fields } = input
    const ctx = { userId: userId!, companyId: companyId!, role: companyRole! }
    const job = await updateJob(ctx, jobId, fields)
    return { id: job.id, status: job.status, updatedAt: job.updatedAt.toISOString() }
  },
)

const jobIdInput = z.object({ jobId: z.string().cuid() })

export const copyJobAction = action(
  {
    auth: { type: 'company', minRole: 'RECRUITER' },
    input: jobIdInput,
  },
  async ({ companyId, userId, companyRole, input }) => {
    const ctx = { userId: userId!, companyId: companyId!, role: companyRole! }
    const t = await getTranslations('jobs')
    const job = await copyJob(ctx, input.jobId, t('copySuffix'))
    return { id: job.id }
  },
)

export const closeJobAction = action(
  {
    auth: { type: 'company', minRole: 'RECRUITER' },
    input: jobIdInput,
  },
  async ({ companyId, userId, companyRole, input }) => {
    const ctx = { userId: userId!, companyId: companyId!, role: companyRole! }
    const job = await closeJob(ctx, input.jobId)
    return { id: job.id, status: job.status }
  },
)
