import 'server-only'
import type { Prisma } from '@prisma/client'
import { db } from '../db'
import { getSetting } from './settings'

/**
 * Single source of truth for talent-pool visibility.
 * PRD §0: visibility=PUBLIC + school verified + completeness >= threshold + account ACTIVE,
 * plus student has not blocked this company.
 * All talent-pool entry points (search, detail, unlock, invite) must call this.
 */
export async function isStudentVisibleToCompany(
  studentId: string,
  companyId: string,
  tx?: Prisma.TransactionClient,
): Promise<boolean> {
  const client = tx ?? db
  // Transaction callers keep all visibility reads on their own connection.
  const minCompleteness = tx
    ? ((await tx.systemSetting.findUnique({ where: { key: 'talentPool.minCompleteness' } }))?.value as number | undefined) ?? 60
    : await getSetting<number>('talentPool.minCompleteness', 60)

  const [student, blocked] = await Promise.all([
    client.studentProfile.findUnique({
      where: { id: studentId },
      select: {
        visibility: true,
        completeness: true,
        schoolVerifiedAt: true,
        user: { select: { status: true } },
      },
    }),
    client.blockedCompany.findUnique({
      where: { studentId_companyId: { studentId, companyId } },
      select: { studentId: true },
    }),
  ])

  if (!student) return false
  if (student.user.status !== 'ACTIVE') return false
  if (student.visibility !== 'PUBLIC') return false
  if (student.schoolVerifiedAt === null) return false
  if (student.completeness < minCompleteness) return false
  if (blocked !== null) return false

  return true
}
