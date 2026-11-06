import { describe, it, expect, vi, beforeEach } from 'vitest'

// Generate test keys before mocking
const mockEnv = vi.hoisted(() => {
  const { randomBytes } = require('crypto') as typeof import('crypto')
  const k1 = randomBytes(32).toString('base64')
  return { PII_KEYS: `v1:${k1}`, PII_ACTIVE_KEY_ID: 'v1' }
})

vi.mock('@/env', () => ({ env: mockEnv }))

// Mock db
const mockDb = vi.hoisted(() => ({
  studentProfile: {
    findUnique: vi.fn(),
  },
  studentContact: {
    findUnique: vi.fn(),
    upsert: vi.fn(),
  },
}))
vi.mock('@/server/db', () => ({ db: mockDb }))

import {
  getOwnContact,
  updateOwnContact,
  updateContactSchema,
} from '@/server/services/contact-access'
import { encryptField } from '@/server/lib/crypto'
import { NotFoundError } from '@/server/errors'

const STUDENT_ID = 'cltest000000student00'
const USER_ID = 'cltest000000user00000'
const ctx = { userId: USER_ID }

beforeEach(() => {
  vi.clearAllMocks()
  mockDb.studentProfile.findUnique.mockResolvedValue({ id: STUDENT_ID })
})

describe('getOwnContact', () => {
  it('returns nulls when no contact row exists', async () => {
    mockDb.studentContact.findUnique.mockResolvedValue(null)
    const result = await getOwnContact(ctx)
    expect(result).toEqual({
      phone: null,
      email: null,
      whatsapp: null,
      wechat: null,
      linkedinUrl: null,
    })
  })

  it('decrypts stored values and returns plaintext', async () => {
    const encPhone = encryptField('+60 12-000 0420', `StudentContact.phone:${STUDENT_ID}`)
    const encEmail = encryptField('test@example.com', `StudentContact.email:${STUDENT_ID}`)
    mockDb.studentContact.findUnique.mockResolvedValue({
      studentId: STUDENT_ID,
      phone: encPhone,
      email: encEmail,
      whatsapp: null,
      wechat: null,
      linkedinUrl: null,
    })
    const result = await getOwnContact(ctx)
    expect(result.phone).toBe('+60 12-000 0420')
    expect(result.email).toBe('test@example.com')
    expect(result.whatsapp).toBeNull()
  })

  it('throws NotFoundError when StudentProfile does not exist', async () => {
    mockDb.studentProfile.findUnique.mockResolvedValue(null)
    await expect(getOwnContact(ctx)).rejects.toBeInstanceOf(NotFoundError)
  })
})

describe('updateOwnContact', () => {
  it('upserts encrypted values into the database', async () => {
    mockDb.studentContact.upsert.mockResolvedValue({})
    await updateOwnContact(ctx, {
      phone: '+60 12-000 0420',
      email: 'test@example.com',
      whatsapp: null,
      wechat: 'wxid_test',
      linkedinUrl: null,
    })
    expect(mockDb.studentContact.upsert).toHaveBeenCalledOnce()
    const { create } = mockDb.studentContact.upsert.mock.calls[0][0]
    expect(create.phone).toMatch(/^enc:v1:/)
    expect(create.email).toMatch(/^enc:v1:/)
    expect(create.wechat).toMatch(/^enc:v1:/)
    expect(create.whatsapp).toBeNull()
    expect(create.linkedinUrl).toBeNull()
  })

  it('stores enc:v1: prefix — database value starts with enc:v', async () => {
    mockDb.studentContact.upsert.mockResolvedValue({})
    await updateOwnContact(ctx, { phone: '+8613800138000' })
    const { create } = mockDb.studentContact.upsert.mock.calls[0][0]
    expect(create.phone.startsWith('enc:v')).toBe(true)
  })

  it('round-trips: written value decrypts back to plaintext', async () => {
    mockDb.studentContact.upsert.mockResolvedValue({})
    await updateOwnContact(ctx, { phone: '+60 12-000 0420' })
    const { create } = mockDb.studentContact.upsert.mock.calls[0][0]
    // Simulate reading it back
    const { decryptField } = await import('@/server/lib/crypto')
    const plaintext = decryptField(create.phone, `StudentContact.phone:${STUDENT_ID}`)
    expect(plaintext).toBe('+60 12-000 0420')
  })
})

describe('updateContactSchema — phone validation', () => {
  const valid = [
    '+60 12-000 0420',   // Malaysian
    '+601234567890',      // Malaysian compact
    '+8613800138000',     // Chinese
    '+447911123456',      // UK
    '+1 555 123 4567',    // US
    '+65 9123 4567',      // Singapore
  ]
  const invalid = [
    '0123456789',         // missing +
    '+',                  // too short
    '12345',              // no +
    '+0123456789',        // starts with +0 (invalid country)
    'not-a-number',
  ]

  for (const phone of valid) {
    it(`accepts ${phone}`, () => {
      expect(updateContactSchema.safeParse({ phone }).success).toBe(true)
    })
  }

  for (const phone of invalid) {
    it(`rejects ${phone}`, () => {
      expect(updateContactSchema.safeParse({ phone }).success).toBe(false)
    })
  }
})
