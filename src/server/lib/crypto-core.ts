import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

// Parse "v1:<b64>[,v2:<b64>]" into a map of keyId → 32-byte Buffer.
function buildKeyMap(keyring: string): Map<string, Buffer> {
  const map = new Map<string, Buffer>()
  for (const part of keyring.split(',')) {
    const sep = part.indexOf(':')
    if (sep === -1) continue
    const keyId = part.slice(0, sep).trim()
    map.set(keyId, Buffer.from(part.slice(sep + 1).trim(), 'base64'))
  }
  return map
}

export function encryptWithKeyring(
  plaintext: string,
  aad: string,
  keyring: string,
  activeKeyId: string,
): string {
  const keys = buildKeyMap(keyring)
  const key = keys.get(activeKeyId)
  if (!key) throw new Error(`Active PII key not found: ${activeKeyId}`)

  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  cipher.setAAD(Buffer.from(aad, 'utf8'))
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return `enc:${activeKeyId}:${Buffer.concat([iv, ct, tag]).toString('base64')}`
}

export function decryptWithKeyring(ciphertext: string, aad: string, keyring: string): string {
  if (!ciphertext.startsWith('enc:')) throw new Error('Invalid ciphertext format')

  const firstColon = 4
  const secondColon = ciphertext.indexOf(':', firstColon)
  if (secondColon === -1) throw new Error('Invalid ciphertext format')

  const keyId = ciphertext.slice(firstColon, secondColon)
  const payloadB64 = ciphertext.slice(secondColon + 1)

  const keys = buildKeyMap(keyring)
  const key = keys.get(keyId)
  if (!key) throw new Error(`Unknown key id: ${keyId}`)

  let payload: Buffer
  try {
    payload = Buffer.from(payloadB64, 'base64')
  } catch {
    throw new Error('Invalid ciphertext encoding')
  }

  if (payload.length < 12 + 16) throw new Error('Ciphertext too short')

  const iv = payload.subarray(0, 12)
  const tag = payload.subarray(payload.length - 16)
  const ct = payload.subarray(12, payload.length - 16)

  try {
    const decipher = createDecipheriv('aes-256-gcm', key, iv)
    decipher.setAAD(Buffer.from(aad, 'utf8'))
    decipher.setAuthTag(tag)
    return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8')
  } catch {
    throw new Error('Decryption failed: authentication tag mismatch or wrong AAD')
  }
}
