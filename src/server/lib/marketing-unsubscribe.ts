import 'server-only'
import { createHmac, timingSafeEqual } from 'node:crypto'
import { env } from '@/env'

const DOMAIN = 'marketing-unsubscribe:v1'
const validUserId = (id: string) => /^[a-zA-Z0-9_-]{1,200}$/.test(id)
function secret(): string | null {
  const value = env.MARKETING_UNSUBSCRIBE_SECRET
  return typeof value === 'string' && Buffer.byteLength(value, 'utf8') >= 32 ? value : null
}
export function marketingUnsubscribeConfigured(): boolean { return secret() !== null }

export function createMarketingUnsubscribeToken(userId: string): string {
  const key = secret()
  if (!key || !validUserId(userId)) throw new Error('Marketing unsubscribe unavailable')
  const payload = Buffer.from(userId, 'utf8').toString('base64url')
  const signature = createHmac('sha256', key).update(DOMAIN + '.' + payload).digest('base64url')
  return payload + '.' + signature
}

export function verifyMarketingUnsubscribeToken(token: string): { userId: string } | null {
  const key = secret()
  if (!key || typeof token !== 'string' || token.length > 512) return null
  const parts = token.split('.')
  if (parts.length !== 2 || !/^[A-Za-z0-9_-]+$/.test(parts[0]) || !/^[A-Za-z0-9_-]{43}$/.test(parts[1])) return null
  const payload = Buffer.from(parts[0], 'base64url'), signature = Buffer.from(parts[1], 'base64url')
  if (payload.toString('base64url') !== parts[0] || signature.toString('base64url') !== parts[1]) return null
  const expected = createHmac('sha256', key).update(DOMAIN + '.' + parts[0]).digest()
  if (signature.length !== expected.length || !timingSafeEqual(signature, expected)) return null
  const userId = payload.toString('utf8')
  return validUserId(userId) && Buffer.from(userId).equals(payload) ? { userId } : null
}
