import 'server-only'
import { db } from '../db'
import { NotFoundError, ForbiddenError } from '../errors'
import type { UserCtx } from '../authz'
import { deleteAllVersions } from '@/lib/storage'
import { lockXact, LOCK_NS } from '../lib/advisory-locks'
import { recalcMatchingEligibilityTx } from './student-profile'

// 学生自己的简历文件：列表、设为主简历、删除。原先写在 actions/resume.ts 里（MA1-T08 抽出来），
// Web Server Action 和 App 的 /api/m/v1/resumes 共用这一份，规则只有一处。

export async function listOwnResumes(ctx: UserCtx) {
  return db.resumeFile.findMany({
    where: { student: { userId: ctx.userId } },
    select: { id: true, fileName: true, sizeBytes: true, pageCount: true, isPrimary: true, createdAt: true },
    orderBy: [{ isPrimary: 'desc' }, { createdAt: 'desc' }],
  })
}

export async function setPrimaryOwnResume(ctx: UserCtx, resumeId: string): Promise<void> {
  await db.$transaction(async tx => {
    await lockXact(tx, LOCK_NS.STUDENT_DATA, ctx.userId)
    const user = await tx.user.findUnique({ where: { id: ctx.userId }, select: { status: true, role: true } })
    if (user?.status !== 'ACTIVE' || user.role !== 'STUDENT') throw new ForbiddenError()
    const profile = await tx.studentProfile.findUnique({ where: { userId: ctx.userId }, select: { id: true } })
    if (!profile) throw new NotFoundError('Student profile not found')
    const resume = await tx.resumeFile.findUnique({ where: { id: resumeId }, select: { studentId: true } })
    if (!resume) throw new NotFoundError('Resume not found')
    if (resume.studentId !== profile.id) throw new ForbiddenError('Access denied')
    await tx.resumeFile.updateMany({ where: { studentId: profile.id }, data: { isPrimary: false } })
    await tx.resumeFile.update({ where: { id: resumeId }, data: { isPrimary: true } })
  })
}

export async function deleteOwnResume(ctx: UserCtx, resumeId: string): Promise<void> {
  const storageKey = await db.$transaction(async tx => {
    await lockXact(tx, LOCK_NS.STUDENT_DATA, ctx.userId)
    const user = await tx.user.findUnique({ where: { id: ctx.userId }, select: { status: true, role: true } })
    if (user?.status !== 'ACTIVE' || user.role !== 'STUDENT') throw new ForbiddenError()
    const profile = await tx.studentProfile.findUnique({ where: { userId: ctx.userId }, select: { id: true } })
    if (!profile) throw new NotFoundError('Student profile not found')
    const resume = await tx.resumeFile.findUnique({ where: { id: resumeId }, select: { studentId: true, storageKey: true } })
    if (!resume) throw new NotFoundError('Resume not found')
    if (resume.studentId !== profile.id) throw new ForbiddenError('Access denied')
    // The real ResumeFile -> ResumeParseDraft FK cascades in this transaction.
    // No worker may recreate either source or draft after this commit.
    await tx.resumeFile.delete({ where: { id: resumeId } })
    await recalcMatchingEligibilityTx(tx, profile.id)
    return resume.storageKey
  })
  // Preserve the existing action error policy; storage failure cannot resurrect DB rows.
  await deleteAllVersions(storageKey)
}
