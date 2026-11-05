#!/usr/bin/env node
// verify-decrypt.ts
// Post-restore verification: confirms the PII encryption keys can decrypt
// StudentContact records in the restored database.
//
// Run via the tools Docker service:
//   docker compose run --rm tools scripts/db/verify-decrypt.ts
//
// Required env: DATABASE_URL, PII_KEYS, PII_ACTIVE_KEY_ID (default: v1)
// Never prints the full decrypted value — only a masked version.

import { PrismaClient } from '@prisma/client'
import { createDecipheriv } from 'crypto'

function buildKeyMap(raw: string): Map<string, Buffer> {
  const map = new Map<string, Buffer>()
  for (const part of raw.split(',')) {
    const sep = part.indexOf(':')
    if (sep === -1) continue
    map.set(part.slice(0, sep), Buffer.from(part.slice(sep + 1), 'base64'))
  }
  return map
}

function decryptField(ciphertext: string, aad: string, keys: Map<string, Buffer>): string {
  if (!ciphertext.startsWith('enc:')) throw new Error('Not an encrypted field (enc: prefix missing)')
  const secondColon = ciphertext.indexOf(':', 4)
  if (secondColon === -1) throw new Error('Malformed ciphertext')
  const keyId = ciphertext.slice(4, secondColon)
  const payload = Buffer.from(ciphertext.slice(secondColon + 1), 'base64')
  if (payload.length < 12 + 16) throw new Error('Ciphertext payload too short')
  const key = keys.get(keyId)
  if (!key) throw new Error(`Key not found in PII_KEYS: ${keyId}`)
  const iv = payload.subarray(0, 12)
  const tag = payload.subarray(payload.length - 16)
  const ct = payload.subarray(12, payload.length - 16)
  const decipher = createDecipheriv('aes-256-gcm', key, iv)
  decipher.setAAD(Buffer.from(aad, 'utf8'))
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8')
}

function mask(value: string): string {
  if (value.length <= 4) return '****'
  return value.slice(0, 2) + '*'.repeat(Math.max(0, value.length - 4)) + value.slice(-2)
}

async function main() {
  const piiKeys = process.env.PII_KEYS
  const dbUrl = process.env.DATABASE_URL
  if (!piiKeys) { console.error('ERROR: PII_KEYS not set'); process.exit(1) }
  if (!dbUrl) { console.error('ERROR: DATABASE_URL not set'); process.exit(1) }

  const keys = buildKeyMap(piiKeys)
  if (keys.size === 0) { console.error('ERROR: PII_KEYS parsed to 0 keys'); process.exit(1) }

  const prisma = new PrismaClient({ datasourceUrl: dbUrl })
  try {
    // Find a StudentContact record with an encrypted phone field
    const contact = await (prisma as any).studentContact.findFirst({
      where: { phone: { not: null } },
      select: { studentId: true, phone: true },
    })

    if (!contact?.phone) {
      console.log('OK: no StudentContact with phone found — nothing to decrypt (expected for empty restore)')
      return
    }

    if (!contact.phone.startsWith('enc:')) {
      console.error('FAIL: phone field exists but is not encrypted (enc: prefix missing)')
      process.exit(1)
    }

    const aad = `StudentContact.phone:${contact.studentId}`
    const plaintext = decryptField(contact.phone, aad, keys)
    console.log(`OK: decrypted StudentContact.phone for student ${contact.studentId} → ${mask(plaintext)}`)
  } finally {
    await prisma.$disconnect()
  }
}

main().catch(err => {
  console.error('FAIL:', err.message)
  process.exit(1)
})
