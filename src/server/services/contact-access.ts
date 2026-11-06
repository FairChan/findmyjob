import 'server-only'
import { db } from '../db'

/** Returns true when the student has at least one non-null contact field. */
export async function hasStudentContact(studentId: string): Promise<boolean> {
  const contact = await db.studentContact.findUnique({
    where: { studentId },
    select: { phone: true, email: true, whatsapp: true, wechat: true, linkedin: true },
  })
  if (contact == null) return false
  return (
    contact.phone != null ||
    contact.email != null ||
    contact.whatsapp != null ||
    contact.wechat != null ||
    contact.linkedin != null
  )
}
