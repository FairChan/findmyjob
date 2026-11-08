'use server'
import { z } from 'zod'
import { action } from '@/server/action'
import {
  sendInvitation,
  acceptInvitation,
  declineInvitation,
} from '@/server/services/invitations'

const sendInvitationInputSchema = z.object({
  studentId: z.string().cuid(),
  jobId: z.string().cuid(),
  message: z.string().max(500).trim().optional().nullable(),
})

const respondInvitationInputSchema = z.object({
  invitationId: z.string().cuid(),
})

export const sendInvitationAction = action(
  { auth: { type: 'company', verified: true }, input: sendInvitationInputSchema },
  async ({ userId, companyId, input }) => {
    return sendInvitation({ userId: userId!, companyId: companyId! }, input)
  },
)

export const acceptInvitationAction = action(
  { auth: 'student', input: respondInvitationInputSchema },
  async ({ userId, input }) => {
    return acceptInvitation({ userId: userId! }, input)
  },
)

export const declineInvitationAction = action(
  { auth: 'student', input: respondInvitationInputSchema },
  async ({ userId, input }) => {
    return declineInvitation({ userId: userId! }, input)
  },
)
