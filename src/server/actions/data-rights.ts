'use server'
import { z } from 'zod'
import { action } from '@/server/action'
import { requestExport, requestDeletion, resolveDataRequest } from '@/server/services/data-rights'

export const requestExportAction = action(
  { auth: 'student', input: z.object({}) },
  async ({ userId }) => {
    return requestExport({ userId: userId! })
  },
)

export const requestDeletionAction = action(
  { auth: 'student', input: z.object({}) },
  async ({ userId }) => {
    await requestDeletion({ userId: userId! })
  },
)

export const resolveDataRequestAction = action(
  {
    auth: 'admin',
    input: z.object({
      requestId: z.string().cuid(),
      resolution: z.enum(['DONE', 'REJECTED']),
      note: z.string().max(500).optional(),
    }),
  },
  async ({ userId, input }) => {
    await resolveDataRequest({ userId: userId! }, input)
  },
)
