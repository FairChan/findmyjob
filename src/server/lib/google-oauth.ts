import 'server-only'
import { createSign } from 'crypto'
import { readFileSync } from 'fs'

// Google 服务账号 JWT → OAuth access token（Play Integrity 和 FCM 共用），只用 Node crypto，不引入 SDK。
// 服务账号 JSON 的路径来自 GOOGLE_SERVICE_ACCOUNT_FILE（生产放 /opt/findmyjob/secrets/，权限 600）。

export class GoogleAuthError extends Error {
  constructor(public readonly reason: string) {
    super(`Google auth failed: ${reason}`)
    this.name = 'GoogleAuthError'
  }
}

type ServiceAccount = { client_email: string; private_key: string; token_uri?: string; project_id?: string }

const FETCH_TIMEOUT_MS = 5_000
const cache = new Map<string, { value: string; expiresAt: number }>()

export function resetGoogleTokenCache(): void {
  cache.clear()
}

export function readServiceAccount(file = process.env.GOOGLE_SERVICE_ACCOUNT_FILE?.trim()): ServiceAccount {
  if (!file) throw new GoogleAuthError('not configured')
  return JSON.parse(readFileSync(file, 'utf8')) as ServiceAccount
}

export async function getGoogleAccessToken(scope: string): Promise<string> {
  const file = process.env.GOOGLE_SERVICE_ACCOUNT_FILE?.trim() ?? ''
  const key = `${file}|${scope}`
  const hit = cache.get(key)
  if (hit && hit.expiresAt > Date.now() + 60_000) return hit.value

  const sa = readServiceAccount(file)
  const tokenUri = sa.token_uri ?? 'https://oauth2.googleapis.com/token'
  const now = Math.floor(Date.now() / 1000)
  const enc = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url')
  const unsigned = `${enc({ alg: 'RS256', typ: 'JWT' })}.${enc({ iss: sa.client_email, scope, aud: tokenUri, iat: now, exp: now + 3600 })}`
  const signature = createSign('RSA-SHA256').update(unsigned).sign(sa.private_key).toString('base64url')
  const res = await fetch(tokenUri, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${unsigned}.${signature}` }),
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  })
  if (!res.ok) throw new GoogleAuthError(`oauth ${res.status}`)
  const data = (await res.json()) as { access_token?: string; expires_in?: number }
  if (!data.access_token) throw new GoogleAuthError('oauth no token')
  cache.set(key, { value: data.access_token, expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000 })
  return data.access_token
}
