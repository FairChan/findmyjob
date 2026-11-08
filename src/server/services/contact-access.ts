import 'server-only'
import { z } from 'zod'
import { db } from '../db'
import { NotFoundError, ForbiddenError } from '../errors'
import { encryptField, decryptField } from '../lib/crypto'
import { logAudit } from './audit'
import type { UserCtx } from '../authz'

export type ContactData = {
  phone: string | null
  email: string | null
  whatsapp: string | null
  wechat: string | null
  linkedinUrl: string | null
}

// Normalize then validate E.164: strip spaces/dashes, expand MY/CN local formats, then require +[1-9]\d{6,14}
const phoneSchema = z.preprocess(
  (val) => {
    if (typeof val !== 'string') return val
    const stripped = val.replace(/[\s\-]/g, '')
    if (/^01\d{8,9}$/.test(stripped)) return `+60${stripped.slice(1)}`
    if (/^1[3-9]\d{9}$/.test(stripped)) return `+86${stripped}`
    return stripped
  },
  z.string().min(1).max(16).regex(/^\+[1-9]\d{6,14}$/, 'invalid_phone_format'),
)

export const updateContactSchema = z.object({
  phone: phoneSchema.nullable().optional(),
  email: z.string().email().max(200).nullable().optional(),
  whatsapp: phoneSchema.nullable().optional(),
  wechat: z.string().min(1).max(100).nullable().optional(),
  linkedinUrl: z
    .string()
    .url()
    .max(300)
    .regex(/^https:\/\/(www\.)?linkedin\.com\//)
    .nullable()
    .optional(),
})

export type UpdateContactInput = z.infer<typeof updateContactSchema>

function contactRowHasData(row: { phone: unknown; email: unknown; whatsapp: unknown; wechat: unknown; linkedinUrl: unknown }): boolean {
  return row.phone != null || row.email != null || row.whatsapp != null || row.wechat != null || row.linkedinUrl != null
}

/** Returns true when the student has at least one non-null contact field. */
export async function hasStudentContact(studentId: string): Promise<boolean> {
  const contact = await db.studentContact.findUnique({
    where: { studentId },
    select: { phone: true, email: true, whatsapp: true, wechat: true, linkedinUrl: true },
  })
  if (contact == null) return false
  return contactRowHasData(contact)
}

/** Transaction-aware version for use inside a Prisma $transaction. */
export async function hasStudentContactTx(
  tx: import('@prisma/client').Prisma.TransactionClient,
  studentId: string,
): Promise<boolean> {
  const contact = await tx.studentContact.findUnique({
    where: { studentId },
    select: { phone: true, email: true, whatsapp: true, wechat: true, linkedinUrl: true },
  })
  if (contact == null) return false
  return contactRowHasData(contact)
}

async function getStudentId(ctx: UserCtx): Promise<string> {
  const profile = await db.studentProfile.findUnique({
    where: { userId: ctx.userId },
    select: { id: true },
  })
  if (!profile) throw new NotFoundError('StudentProfile not found')
  return profile.id
}

function aad(field: string, studentId: string): string {
  return `StudentContact.${field}:${studentId}`
}

function encryptIfPresent(value: string | null | undefined, field: string, studentId: string) {
  if (value == null || value === '') return null
  return encryptField(value, aad(field, studentId))
}

function decryptIfPresent(value: string | null, field: string, studentId: string) {
  if (value == null) return null
  return decryptField(value, aad(field, studentId))
}

/** Reads and decrypts the student's own contact info. */
export async function getOwnContact(ctx: UserCtx): Promise<ContactData> {
  const studentId = await getStudentId(ctx)
  const row = await db.studentContact.findUnique({ where: { studentId } })
  if (!row) {
    return { phone: null, email: null, whatsapp: null, wechat: null, linkedinUrl: null }
  }
  return {
    phone: decryptIfPresent(row.phone, 'phone', studentId),
    email: decryptIfPresent(row.email, 'email', studentId),
    whatsapp: decryptIfPresent(row.whatsapp, 'whatsapp', studentId),
    wechat: decryptIfPresent(row.wechat, 'wechat', studentId),
    linkedinUrl: decryptIfPresent(row.linkedinUrl, 'linkedinUrl', studentId),
  }
}

/**
 * Batch version: returns a Set of studentIds for which the given company can see full identity.
 * Checks: company isActive + VERIFIED, TalentUnlock exists, student not blocked, student ACTIVE.
 * M4-T09 and M5 callers that need a single-student check should use canSeeIdentity (delegates here).
 */
export async function canSeeIdentityMany(companyId: string, studentIds: string[]): Promise<Set<string>> {
  if (studentIds.length === 0) return new Set()

  const company = await db.company.findUnique({
    where: { id: companyId },
    select: { isActive: true, verificationStatus: true },
  })
  if (!company || !company.isActive || company.verificationStatus !== 'VERIFIED') return new Set()

  const [unlocks, blocked, profiles] = await Promise.all([
    db.talentUnlock.findMany({
      where: { companyId, studentId: { in: studentIds } },
      select: { studentId: true },
    }),
    db.blockedCompany.findMany({
      where: { companyId, studentId: { in: studentIds } },
      select: { studentId: true },
    }),
    db.studentProfile.findMany({
      where: { id: { in: studentIds } },
      select: { id: true, userId: true },
    }),
  ])

  // Query User separately to avoid Prisma "Inconsistent query result" on orphaned profiles.
  const userIds = profiles.map((p) => p.userId)
  const users = await db.user.findMany({
    where: { id: { in: userIds } },
    select: { id: true, status: true },
  })
  const userStatusMap = new Map(users.map((u) => [u.id, u.status]))

  const unlockedSet = new Set(unlocks.map((u) => u.studentId))
  const blockedSet = new Set(blocked.map((b) => b.studentId))
  const activeSet = new Set(
    profiles.filter((p) => userStatusMap.get(p.userId) === 'ACTIVE').map((p) => p.id),
  )

  return new Set(studentIds.filter((id) => unlockedSet.has(id) && !blockedSet.has(id) && activeSet.has(id)))
}

/**
 * Fine-grained identity access check returning one of:
 *  'ok'        — company may see the student's identity
 *  'no_unlock' — no TalentUnlock exists (or company not active/verified)
 *  'gone'      — student blocked the company, or student account SUSPENDED/DELETED,
 *                or student profile no longer exists
 *
 * Use the return value to map gone → 404 and no_unlock → 403 in HTTP handlers.
 */
export async function identityAccess(
  companyId: string,
  studentId: string,
): Promise<'ok' | 'no_unlock' | 'gone'> {
  const company = await db.company.findUnique({
    where: { id: companyId },
    select: { isActive: true, verificationStatus: true },
  })
  if (!company || !company.isActive || company.verificationStatus !== 'VERIFIED') {
    return 'no_unlock'
  }

  const [unlock, blocked, profile] = await Promise.all([
    db.talentUnlock.findUnique({
      where: { companyId_studentId: { companyId, studentId } },
      select: { id: true },
    }),
    db.blockedCompany.findFirst({
      where: { companyId, studentId },
      select: { studentId: true },
    }),
    db.studentProfile.findUnique({
      where: { id: studentId },
      select: { id: true, userId: true },
    }),
  ])

  if (!unlock) return 'no_unlock'
  if (blocked) return 'gone'
  if (!profile) return 'gone'

  const user = await db.user.findUnique({
    where: { id: profile.userId },
    select: { status: true },
  })
  if (!user || user.status !== 'ACTIVE') return 'gone'

  return 'ok'
}

/**
 * Returns true when a company can see a student's full identity (name + contact):
 * - Company isActive + VERIFIED
 * - TalentUnlock exists for this company+student
 * - Student has NOT blocked this company
 * - Student account is ACTIVE
 */
export async function canSeeIdentity(companyId: string, studentId: string): Promise<boolean> {
  return (await identityAccess(companyId, studentId)) === 'ok'
}

/**
 * Returns decrypted contact data for a student, gated by canSeeIdentity.
 * Throws ForbiddenError if the company is not allowed to see the contact.
 * This is the ONLY function that may read and decrypt student contact fields.
 *
 * Writes a contact.read audit record in the same transaction as the read (fail closed).
 * The audit metadata never contains decrypted values — only internal IDs.
 */
export async function getContactForCompany(
  companyId: string,
  studentId: string,
  ctx: { userId: string },
): Promise<ContactData> {
  const canSee = await canSeeIdentity(companyId, studentId)
  if (!canSee) throw new ForbiddenError()

  return db.$transaction(async (tx) => {
    const row = await tx.studentContact.findUnique({ where: { studentId } })

    // Audit before returning; fail closed — if this throws the read does not land.
    await logAudit({
      actorId: ctx.userId,
      action: 'contact.read',
      targetType: 'StudentContact',
      targetId: studentId,
      metadata: { companyId, studentId },
    }, tx)

    if (!row) {
      return { phone: null, email: null, whatsapp: null, wechat: null, linkedinUrl: null }
    }

    return {
      phone: decryptIfPresent(row.phone, 'phone', studentId),
      email: decryptIfPresent(row.email, 'email', studentId),
      whatsapp: decryptIfPresent(row.whatsapp, 'whatsapp', studentId),
      wechat: decryptIfPresent(row.wechat, 'wechat', studentId),
      linkedinUrl: decryptIfPresent(row.linkedinUrl, 'linkedinUrl', studentId),
    }
  })
}

/**
 * Admin-only: returns decrypted contact data for any student profile.
 * Writes a contact.read audit record. The caller must have already verified ADMIN role.
 */
export async function getContactForAdmin(
  studentProfileId: string,
  ctx: UserCtx,
  ip?: string,
): Promise<ContactData> {
  return db.$transaction(async (tx) => {
    const actor = await tx.user.findUnique({ where: { id: ctx.userId }, select: { role: true, status: true } })
    if (!actor || actor.role !== 'ADMIN' || actor.status !== 'ACTIVE') throw new ForbiddenError()

    const row = await tx.studentContact.findUnique({ where: { studentId: studentProfileId } })

    await logAudit({
      actorId: ctx.userId,
      action: 'contact.read',
      targetType: 'StudentContact',
      targetId: studentProfileId,
      metadata: { source: 'admin' },
      ip,
    }, tx)

    if (!row) {
      return { phone: null, email: null, whatsapp: null, wechat: null, linkedinUrl: null }
    }

    return {
      phone: decryptIfPresent(row.phone, 'phone', studentProfileId),
      email: decryptIfPresent(row.email, 'email', studentProfileId),
      whatsapp: decryptIfPresent(row.whatsapp, 'whatsapp', studentProfileId),
      wechat: decryptIfPresent(row.wechat, 'wechat', studentProfileId),
      linkedinUrl: decryptIfPresent(row.linkedinUrl, 'linkedinUrl', studentProfileId),
    }
  })
}

/** Encrypts and upserts the student's own contact info. */
export async function updateOwnContact(ctx: UserCtx, input: UpdateContactInput): Promise<void> {
  const studentId = await getStudentId(ctx)
  const data = {
    phone: encryptIfPresent(input.phone, 'phone', studentId),
    email: encryptIfPresent(input.email, 'email', studentId),
    whatsapp: encryptIfPresent(input.whatsapp, 'whatsapp', studentId),
    wechat: encryptIfPresent(input.wechat, 'wechat', studentId),
    linkedinUrl: encryptIfPresent(input.linkedinUrl, 'linkedinUrl', studentId),
  }
  await db.studentContact.upsert({
    where: { studentId },
    create: { studentId, ...data },
    update: data,
  })
}

/** PDPA purge: hard-delete the contact record for a deleted student. Must run inside a transaction. */
export async function purgeContactForStudent(
  tx: Parameters<Parameters<typeof db.$transaction>[0]>[0],
  studentId: string,
): Promise<void> {
  await tx.studentContact.delete({ where: { studentId } })
}
