'use server'
import { action } from '@/server/action'
import { db } from '@/server/db'
import { deleteAllVersions } from '@/lib/storage'
import { NotFoundError, ForbiddenError } from '@/server/errors'
import { z } from 'zod'

export const setPrimaryResume = action(
  { auth: 'student', input: z.object({ resumeId: z.string().cuid() }) },
  async ctx => {
    const { userId, input } = ctx
    const { resumeId } = input

    const profile = await db.studentProfile.findUnique({
      where: { userId },
      select: { id: true },
    })
    if (!profile) throw new NotFoundError('Student profile not found')

    const resume = await db.resumeFile.findUnique({
      where: { id: resumeId },
      select: { studentId: true },
    })
    if (!resume) throw new NotFoundError('Resume not found')
    if (resume.studentId !== profile.id) throw new ForbiddenError('Access denied')

    await db.$transaction([
      db.resumeFile.updateMany({
        where: { studentId: profile.id },
        data: { isPrimary: false },
      }),
      db.resumeFile.update({
        where: { id: resumeId },
        data: { isPrimary: true },
      }),
    ])

    return { ok: true as const }
  },
)

export const deleteResume = action(
  { auth: 'student', input: z.object({ resumeId: z.string().cuid() }) },
  async ctx => {
    const { userId, input } = ctx
    const { resumeId } = input

    const profile = await db.studentProfile.findUnique({
      where: { userId },
      select: { id: true },
    })
    if (!profile) throw new NotFoundError('Student profile not found')

    const resume = await db.resumeFile.findUnique({
      where: { id: resumeId },
      select: { id: true, studentId: true, storageKey: true },
    })
    if (!resume) throw new NotFoundError('Resume not found')
    if (resume.studentId !== profile.id) throw new ForbiddenError('Access denied')

    await db.resumeFile.delete({ where: { id: resumeId } })
    await deleteAllVersions(resume.storageKey)

    return { ok: true as const }
  },
)
