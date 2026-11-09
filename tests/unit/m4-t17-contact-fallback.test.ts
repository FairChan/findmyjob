import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  env: {
    PII_KEYS: 'v1:' + Buffer.alloc(32, 17).toString('base64'),
    PII_ACTIVE_KEY_ID: 'v1',
  },
  profile: vi.fn(),
  contact: vi.fn(),
  company: vi.fn(),
  unlock: vi.fn(),
  blocked: vi.fn(),
  user: vi.fn(),
  upsert: vi.fn(),
  alert: vi.fn(),
}))

vi.mock('@/env', () => ({ env: mocks.env }))
vi.mock('@/server/db', () => {
  const db = {
    studentProfile: { findUnique: mocks.profile },
    studentContact: { findUnique: mocks.contact, upsert: mocks.upsert },
    company: { findUnique: mocks.company },
    talentUnlock: { findUnique: mocks.unlock },
    blockedCompany: { findFirst: mocks.blocked },
    user: { findUnique: mocks.user },
  }
  return { db: { ...db, $transaction: async (fn: (tx: typeof db) => Promise<unknown>) => fn(db) } }
})
vi.mock('@/server/services/audit', () => ({ logAudit: vi.fn() }))
vi.mock('@/server/lib/alert', () => ({ alert: mocks.alert }))

import {
  getContactForAdmin,
  getContactForCompany,
  getOwnContact,
  updateOwnContact,
} from '@/server/services/contact-access'
import { encryptField } from '@/server/lib/crypto'
import { DecryptError } from '@/server/errors'

const STUDENT_ID = 'clm4t17student000000000001'
const USER_ID = 'clm4t17user00000000000001'
const COMPANY_ID = 'clm4t17company00000000001'
const fields = ['phone', 'email', 'whatsapp', 'wechat', 'linkedinUrl'] as const
type Field = (typeof fields)[number]
const plaintext: Record<Field, string> = {
  phone: '+601200000420',
  email: 'contact-fallback@example.test',
  whatsapp: '+601100000421',
  wechat: 'm4t17-fictional-contact',
  linkedinUrl: 'https://www.linkedin.com/in/m4t17-fictional',
}

function encryptedRow(badField?: Field) {
  const row: Record<Field, string> = { ...plaintext }
  for (const field of fields) {
    const owner = field === badField ? 'a-different-student' : STUDENT_ID
    row[field] = encryptField(plaintext[field], 'StudentContact.' + field + ':' + owner)
  }
  return { studentId: STUDENT_ID, ...row }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.env.PII_KEYS = 'v1:' + Buffer.alloc(32, 17).toString('base64')
  mocks.env.PII_ACTIVE_KEY_ID = 'v1'
  mocks.profile.mockResolvedValue({ id: STUDENT_ID, userId: USER_ID })
  mocks.company.mockResolvedValue({ isActive: true, verificationStatus: 'VERIFIED' })
  mocks.unlock.mockResolvedValue({ id: 'unlocked-contact' })
  mocks.blocked.mockResolvedValue(null)
  mocks.user.mockResolvedValue({ role: 'ADMIN', status: 'ACTIVE' })
})

describe.each([
  ['company', () => getContactForCompany(COMPANY_ID, STUDENT_ID, { userId: 'employer-user' })],
  ['admin', () => getContactForAdmin(STUDENT_ID, { userId: 'admin-user' })],
] as const)('M4-T17: %s read-only contact fields degrade independently', (_role, readContact) => {
  it.each(fields)('%s authentication failure returns null while preserving other fields', async (field) => {
    mocks.contact.mockResolvedValue(encryptedRow(field))

    // Real AES-GCM decryption fails for just this field because its AAD is wrong.
    const result = await readContact()

    expect(result).toEqual({ ...plaintext, [field]: null })
    expect(mocks.alert).toHaveBeenCalledExactlyOnceWith(
      'contact.decrypt_failed',
      { studentId: STUDENT_ID, field },
    )
  })

  it('does not alert when every field is valid', async () => {
    mocks.contact.mockResolvedValue(encryptedRow())

    expect(await readContact()).toEqual(plaintext)
    expect(mocks.alert).not.toHaveBeenCalled()
  })
})

describe('M4-T17: owner contact editing fails closed', () => {
  it.each(fields)('rejects an unreadable %s instead of returning an editable null', async (field) => {
    mocks.contact.mockResolvedValue(encryptedRow(field))

    await expect(getOwnContact({ userId: USER_ID })).rejects.toBeInstanceOf(DecryptError)
    expect(mocks.upsert).not.toHaveBeenCalled()
  })

  it('prevents editing another field from clearing ciphertext when its key is temporarily missing', async () => {
    const row = encryptedRow()
    // Keep only phone under v1; all other fields remain readable under v2.
    mocks.env.PII_KEYS = 'v2:' + Buffer.alloc(32, 29).toString('base64')
    mocks.env.PII_ACTIVE_KEY_ID = 'v2'
    const readableFields = encryptedRow()
    mocks.contact.mockResolvedValue({ ...readableFields, phone: row.phone })

    const editAnotherField = async () => {
      // ContactPage supplies this initial object to ContactForm, whose submit
      // sends every contact field even when the student edits only their email.
      const initial = await getOwnContact({ userId: USER_ID })
      await updateOwnContact({ userId: USER_ID }, { ...initial, email: 'edited@example.test' })
    }

    await expect(editAnotherField()).rejects.toBeInstanceOf(DecryptError)
    expect(mocks.upsert).not.toHaveBeenCalled()
  })
})
