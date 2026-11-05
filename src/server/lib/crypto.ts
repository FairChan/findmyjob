import 'server-only'
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto'
import { env } from '@/env'
import { DecryptError } from '@/server/errors'

// Parse "v1:<b64>[,v2:<b64>]" into a map of keyId → 32-byte Buffer.
function buildKeyMap(): Map<string, Buffer> {
  const map = new Map<string, Buffer>()
  for (const part of env.PII_KEYS.split(',')) {
    const sep = part.indexOf(':')
    if (sep === -1) continue
    const keyId = part.slice(0, sep)
    map.set(keyId, Buffer.from(part.slice(sep + 1), 'base64'))
  }
  return map
}

export function encryptField(plaintext: string, aad: string): string {
  const keys = buildKeyMap()
  const keyId = env.PII_ACTIVE_KEY_ID
  const key = keys.get(keyId)
  if (!key) throw new Error(`Active PII key not found: ${keyId}`)

  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  cipher.setAAD(Buffer.from(aad, 'utf8'))
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag() // always 16 bytes for GCM
  return `enc:${keyId}:${Buffer.concat([iv, ct, tag]).toString('base64')}`
}

export function decryptField(ciphertext: string, aad: string): string {
  if (!ciphertext.startsWith('enc:')) throw new DecryptError('Invalid ciphertext format')

  // Format: enc:<keyId>:<base64(iv12‖ct‖tag16)>
  const firstColon = 4 // after 'enc:'
  const secondColon = ciphertext.indexOf(':', firstColon)
  if (secondColon === -1) throw new DecryptError('Invalid ciphertext format')

  const keyId = ciphertext.slice(firstColon, secondColon)
  const payloadB64 = ciphertext.slice(secondColon + 1)

  const keys = buildKeyMap()
  const key = keys.get(keyId)
  if (!key) throw new DecryptError(`Unknown key id: ${keyId}`)

  let payload: Buffer
  try {
    payload = Buffer.from(payloadB64, 'base64')
  } catch {
    throw new DecryptError('Invalid ciphertext encoding')
  }

  if (payload.length < 12 + 16) throw new DecryptError('Ciphertext too short')

  const iv = payload.subarray(0, 12)
  const tag = payload.subarray(payload.length - 16)
  const ct = payload.subarray(12, payload.length - 16)

  try {
    const decipher = createDecipheriv('aes-256-gcm', key, iv)
    decipher.setAAD(Buffer.from(aad, 'utf8'))
    decipher.setAuthTag(tag)
    return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8')
  } catch {
    throw new DecryptError('Decryption failed: authentication tag mismatch or wrong AAD')
  }
}
