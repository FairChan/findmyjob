'use server'
import { z } from 'zod'
import { ApplicationStatus } from '@prisma/client'
import { action } from '@/server/action'
import { changeApplicationStatus, updateApplicationNote, markApplicationViewed } from '@/server/services/applicants'

const changeStatusInput = z.object({
  applicationId: z.string().cuid(),
  toStatus: z.nativeEnum(ApplicationStatus),
  note: z.string().max(2000).nullable().optional(),
})

export const changeStatusAction = action(
  {
    auth: { type: 'company', minRole: 'RECRUITER', verified: true },
    input: changeStatusInput,
  },
  async ({ companyId, userId, companyRole, input }) => {
    const ctx = { userId: userId!, companyId: companyId!, role: companyRole! }
    await changeApplicationStatus(ctx, input)
  },
)

const updateNoteInput = z.object({
  applicationId: z.string().cuid(),
  note: z.string().max(2000).nullable(),
})

export const updateNoteAction = action(
  {
    auth: { type: 'company', minRole: 'RECRUITER', verified: true },
    input: updateNoteInput,
  },
  async ({ companyId, userId, companyRole, input }) => {
    const ctx = { userId: userId!, companyId: companyId!, role: companyRole! }
    await updateApplicationNote(ctx, input)
  },
)

const markViewedInput = z.object({
  applicationId: z.string().cuid(),
})

export const markViewedAction = action(
  {
    auth: { type: 'company', minRole: 'RECRUITER', verified: true },
    input: markViewedInput,
  },
  async ({ companyId, userId, companyRole, input }) => {
    const ctx = { userId: userId!, companyId: companyId!, role: companyRole! }
    await markApplicationViewed(ctx, input.applicationId)
  },
)
