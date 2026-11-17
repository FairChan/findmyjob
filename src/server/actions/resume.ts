'use server'
import { action } from '@/server/action'
import { deleteOwnResume, listOwnResumes, setPrimaryOwnResume } from '@/server/services/resume-files'
import { z } from 'zod'

export const getOwnResumesAction = action({ auth: 'student' }, async ({ userId }) => ({
  resumes: await listOwnResumes({ userId: userId! }),
}))

export const setPrimaryResume = action(
  { auth: 'student', input: z.object({ resumeId: z.string().cuid() }) },
  async ({ userId, input }) => {
    await setPrimaryOwnResume({ userId: userId! }, input.resumeId)
    return { ok: true as const }
  },
)

export const deleteResume = action(
  { auth: 'student', input: z.object({ resumeId: z.string().cuid() }) },
  async ({ userId, input }) => {
    await deleteOwnResume({ userId: userId! }, input.resumeId)
    return { ok: true as const }
  },
)
