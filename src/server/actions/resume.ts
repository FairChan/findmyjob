'use server'
import { action } from '@/server/action'
import { db } from '@/server/db'
import { deleteAllVersions } from '@/lib/storage'
import { NotFoundError, ForbiddenError } from '@/server/errors'
import { lockXact, LOCK_NS } from '@/server/lib/advisory-locks'
import { recalcMatchingEligibilityTx } from '@/server/services/student-profile'
import { z } from 'zod'

export const getOwnResumesAction = action({ auth: 'student' }, async ({ userId }) => ({
  resumes: await db.resumeFile.findMany({
    where: { student: { userId: userId! } },
    select: { id: true, fileName: true, sizeBytes: true, pageCount: true, isPrimary: true, createdAt: true },
    orderBy: [{ isPrimary: 'desc' }, { createdAt: 'desc' }],
  }),
}))

export const setPrimaryResume = action(
  { auth: 'student', input: z.object({ resumeId: z.string().cuid() }) },
  async ({ userId, input }) => {
    await db.$transaction(async tx => {
      await lockXact(tx, LOCK_NS.STUDENT_DATA, userId!)
      const user = await tx.user.findUnique({ where: { id: userId! }, select: { status: true, role: true } })
      if (user?.status !== 'ACTIVE' || user.role !== 'STUDENT') throw new ForbiddenError()
      const profile = await tx.studentProfile.findUnique({ where: { userId: userId! }, select: { id: true } })
      if (!profile) throw new NotFoundError('Student profile not found')
      const resume = await tx.resumeFile.findUnique({ where: { id: input.resumeId }, select: { studentId: true } })
      if (!resume) throw new NotFoundError('Resume not found')
      if (resume.studentId !== profile.id) throw new ForbiddenError('Access denied')
      await tx.resumeFile.updateMany({ where: { studentId: profile.id }, data: { isPrimary: false } })
      await tx.resumeFile.update({ where: { id: input.resumeId }, data: { isPrimary: true } })
    })
    return { ok: true as const }
  },
)

export const deleteResume = action(
  { auth: 'student', input: z.object({ resumeId: z.string().cuid() }) },
  async ({ userId, input }) => {
    const storageKey = await db.$transaction(async tx => {
      await lockXact(tx, LOCK_NS.STUDENT_DATA, userId!)
      const user = await tx.user.findUnique({ where: { id: userId! }, select: { status: true, role: true } })
      if (user?.status !== 'ACTIVE' || user.role !== 'STUDENT') throw new ForbiddenError()
      const profile = await tx.studentProfile.findUnique({ where: { userId: userId! }, select: { id: true } })
      if (!profile) throw new NotFoundError('Student profile not found')
      const resume = await tx.resumeFile.findUnique({ where: { id: input.resumeId }, select: { studentId: true, storageKey: true } })
      if (!resume) throw new NotFoundError('Resume not found')
      if (resume.studentId !== profile.id) throw new ForbiddenError('Access denied')
      // The real ResumeFile -> ResumeParseDraft FK cascades in this transaction.
      // No worker may recreate either source or draft after this commit.
      await tx.resumeFile.delete({ where: { id: input.resumeId } })
      await recalcMatchingEligibilityTx(tx, profile.id)
      return resume.storageKey
    })
    // Preserve the existing action error policy; storage failure cannot resurrect DB rows.
    await deleteAllVersions(storageKey)
    return { ok: true as const }
  },
)
