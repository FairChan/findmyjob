import type { PrismaClient } from '@prisma/client'
import { encryptField } from '@/server/lib/crypto'

/** Synthetic saved materials for integration scenarios that require an eligible applicant. */
export async function seedApplicationMaterials(db: PrismaClient, studentId: string) {
  await db.studentContact.upsert({
    where: { studentId },
    create: { studentId, email: encryptField('applicant@example.test', `StudentContact.email:${studentId}`) },
    update: {},
  })
  return db.resumeFile.create({
    data: {
      studentId, fileName: 'synthetic-resume.pdf', storageKey: `resumes/${studentId}/synthetic.pdf`,
      mimeType: 'application/pdf', sizeBytes: 1000, isPrimary: true,
    },
  })
}
