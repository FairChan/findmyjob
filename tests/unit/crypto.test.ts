import { describe, it, expect, vi, afterEach } from 'vitest'
import { randomBytes } from 'crypto'

// Generate test keys at runtime — never store key literals in source.
// vi.hoisted runs before imports, so randomBytes must be required inline.
const mockEnv = vi.hoisted(() => {
  const { randomBytes: rb } = require('crypto') as typeof import('crypto')
  const k1: string = rb(32).toString('base64')
  const k2: string = rb(32).toString('base64')
  const keyRing = `v1:${k1},v2:${k2}`
  return {
    PII_KEYS: keyRing,
    PII_ACTIVE_KEY_ID: 'v1',
  }
})

vi.mock('@/env', () => ({ env: mockEnv }))

import { encryptField, decryptField } from '@/server/lib/crypto'
import { DecryptError } from '@/server/errors'

afterEach(() => {
  mockEnv.PII_ACTIVE_KEY_ID = 'v1'
})

const AAD_A = 'StudentContact.phone:student-aaa'
const AAD_B = 'StudentContact.phone:student-bbb'

// suppress unused imports
void randomBytes

describe('encryptField / decryptField', () => {
  it('roundtrip: encrypt then decrypt returns original plaintext', () => {
    const ct = encryptField('hello findmyjob', AAD_A)
    expect(decryptField(ct, AAD_A)).toBe('hello findmyjob')
  })

  it('ciphertext starts with enc:v1:', () => {
    const ct = encryptField('test', AAD_A)
    expect(ct.startsWith('enc:v1:')).toBe(true)
  })

  it('modified GCM tag causes DecryptError', () => {
    const ct = encryptField('secret', AAD_A)
    // Flip one base64 char in the payload (last 4 chars include the GCM tag region)
    const parts = ct.split(':')
    const payload = parts[2]
    const tampered =
      payload.slice(0, -4) +
      (payload.at(-4) === 'A' ? 'B' : 'A') +
      payload.slice(-3)
    const tamperedCt = `enc:${parts[1]}:${tampered}`
    expect(() => decryptField(tamperedCt, AAD_A)).toThrow(DecryptError)
  })

  it('wrong AAD (student B reads student A ciphertext) causes DecryptError', () => {
    const ct = encryptField('private data', AAD_A)
    expect(() => decryptField(ct, AAD_B)).toThrow(DecryptError)
  })

  it('key rotation: v1-encrypted data decryptable when v2 is active', () => {
    mockEnv.PII_ACTIVE_KEY_ID = 'v1'
    const ct = encryptField('rotate me', AAD_A)
    expect(ct.startsWith('enc:v1:')).toBe(true)

    // Switch active key to v2 — new encrypts use v2, but v1 ciphertext still readable
    mockEnv.PII_ACTIVE_KEY_ID = 'v2'
    expect(decryptField(ct, AAD_A)).toBe('rotate me')
  })

  it('new encryptions use v2 when v2 is active', () => {
    mockEnv.PII_ACTIVE_KEY_ID = 'v2'
    const ct = encryptField('new value', AAD_A)
    expect(ct.startsWith('enc:v2:')).toBe(true)
    expect(decryptField(ct, AAD_A)).toBe('new value')
  })

  it('10,000 IVs are unique', () => {
    const ivSet = new Set<string>()
    for (let i = 0; i < 10_000; i++) {
      const ct = encryptField('x', AAD_A)
      const payload = Buffer.from(ct.split(':')[2], 'base64')
      ivSet.add(payload.subarray(0, 12).toString('hex'))
    }
    expect(ivSet.size).toBe(10_000)
  })

  it('non-empty StudentContact field values start with enc:v', () => {
    const fields = ['phone', 'email', 'whatsapp', 'wechat', 'linkedin']
    for (const field of fields) {
      const aad = `StudentContact.${field}:student-xyz`
      const ct = encryptField('+60 12-345 6789', aad)
      expect(ct).toMatch(/^enc:v/)
    }
  })

  it('invalid ciphertext format throws DecryptError', () => {
    expect(() => decryptField('notencrypted', AAD_A)).toThrow(DecryptError)
    expect(() => decryptField('enc:only_one_colon', AAD_A)).toThrow(DecryptError)
  })

  it('unknown keyId throws DecryptError', () => {
    const ct = encryptField('test', AAD_A)
    const parts = ct.split(':')
    const badCt = `enc:v99:${parts[2]}`
    expect(() => decryptField(badCt, AAD_A)).toThrow(DecryptError)
  })
})

