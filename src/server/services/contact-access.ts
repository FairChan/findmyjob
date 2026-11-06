import 'server-only'
import { z } from 'zod'
import { db } from '../db'
import { NotFoundError } from '../errors'
import { encryptField, decryptField } from '../lib/crypto'
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
