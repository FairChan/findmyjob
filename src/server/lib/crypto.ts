import 'server-only'
import { env } from '@/env'
import { DecryptError } from '@/server/errors'
import { encryptWithKeyring, decryptWithKeyring } from './crypto-core'

export function encryptField(plaintext: string, aad: string): string {
  return encryptWithKeyring(plaintext, aad, env.PII_KEYS, env.PII_ACTIVE_KEY_ID)
}

export function decryptField(ciphertext: string, aad: string): string {
  try {
    return decryptWithKeyring(ciphertext, aad, env.PII_KEYS)
  } catch (e) {
    throw new DecryptError((e as Error).message)
  }
}
