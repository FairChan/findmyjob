import 'server-only'
import type { Prisma } from '@prisma/client'
import { ContactRequiredError, NotFoundError, ResumeRequiredError } from '../errors'
import { hasStudentContactTx } from './contact-access'

/** Caller holds STUDENT_DATA so contact/resume deletion cannot race this check. */
export async function requireApplicationMaterialsTx(
  tx: Prisma.TransactionClient,
  studentId: string,
  resumeId?: string | null,
): Promise<string> {
  if (!await hasStudentContactTx(tx, studentId)) throw new ContactRequiredError()
  const resume = await tx.resumeFile.findFirst({
    where: { studentId, ...(resumeId ? { id: resumeId } : {}) },
    select: { id: true },
    orderBy: [{ isPrimary: 'desc' }, { createdAt: 'desc' }],
  })
  if (!resume) {
    if (resumeId) throw new NotFoundError('Resume not found')
    throw new ResumeRequiredError()
  }
  return resume.id
}
