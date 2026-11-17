import 'server-only'
import { createHash, createSign } from 'crypto'
import { readFileSync } from 'fs'
import { Prisma } from '@prisma/client'
import { db } from '../db'
import { logger } from './logger'

/**
 * Play Integrity（标准请求）替代 Turnstile 的服务端校验（MA1-T03）。
 *
 * App 在调用受 Turnstile 保护的 5 个认证端点前，用 requestHash = playIntegrityRequestHash(action, email)
 * 向 Google 要一个 integrity token，放进请求体的 integrityToken 字段。服务端解码后校验：
 * 包名、请求摘要、签名证书、Play 识别的正版、设备完整性、时间戳在 5 分钟内，并且同一个 token 只能用一次。
 * 没配置（还没有 Google 服务账号）时 isPlayIntegrityConfigured() 为 false，App 直接走 WebView 里的 Turnstile。
 * 官网直装的 APK 在 Play 看来是 UNRECOGNIZED_VERSION，也会失败并回退到 Turnstile，这是预期行为。
 */

export class PlayIntegrityError extends Error {
  constructor(public readonly reason: string) {
    super(`Play Integrity verification failed: ${reason}`)
    this.name = 'PlayIntegrityError'
  }
}

const MAX_AGE_MS = 5 * 60_000
const FETCH_TIMEOUT_MS = 5_000
const SCOPE = 'https://www.googleapis.com/auth/playintegrity'

type Config = { packageName: string; certDigests: string[]; serviceAccountFile: string }

function readConfig(): Config | null {
  const packageName = process.env.PLAY_INTEGRITY_PACKAGE_NAME?.trim()
  const serviceAccountFile = process.env.GOOGLE_SERVICE_ACCOUNT_FILE?.trim()
  const certDigests = (process.env.ANDROID_CERT_SHA256 ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  if (!packageName || !serviceAccountFile || certDigests.length === 0) return null
  return { packageName, certDigests, serviceAccountFile }
}

export function isPlayIntegrityConfigured(): boolean {
  return readConfig() !== null
}

/** App 和服务端用同一个算法得到 requestHash：绑定动作和邮箱，防止把别处拿到的 token 挪用过来 */
export function playIntegrityRequestHash(action: string, email: string): string {
  return createHash('sha256').update(`findmyjob:${action}:${email.trim().toLowerCase()}`).digest('base64url')
}

// ---- Google OAuth（服务账号 JWT → access token），不引入新依赖 ----

type ServiceAccount = { client_email: string; private_key: string; token_uri?: string }
let cachedToken: { value: string; expiresAt: number } | null = null

export function resetPlayIntegrityTokenCache(): void {
  cachedToken = null
}

async function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
  return fetch(url, { ...init, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })
}

async function accessToken(cfg: Config): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) return cachedToken.value
  const sa = JSON.parse(readFileSync(cfg.serviceAccountFile, 'utf8')) as ServiceAccount
  const tokenUri = sa.token_uri ?? 'https://oauth2.googleapis.com/token'
  const now = Math.floor(Date.now() / 1000)
  const enc = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url')
  const unsigned = `${enc({ alg: 'RS256', typ: 'JWT' })}.${enc({ iss: sa.client_email, scope: SCOPE, aud: tokenUri, iat: now, exp: now + 3600 })}`
  const signature = createSign('RSA-SHA256').update(unsigned).sign(sa.private_key).toString('base64url')
  const res = await fetchWithTimeout(tokenUri, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${unsigned}.${signature}` }),
  })
  if (!res.ok) throw new PlayIntegrityError(`oauth ${res.status}`)
  const data = (await res.json()) as { access_token?: string; expires_in?: number }
  if (!data.access_token) throw new PlayIntegrityError('oauth no token')
  cachedToken = { value: data.access_token, expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000 }
  return cachedToken.value
}

type Payload = {
  requestDetails?: { requestPackageName?: string; requestHash?: string; timestampMillis?: string }
  appIntegrity?: { appRecognitionVerdict?: string; packageName?: string; certificateSha256Digest?: string[] }
  deviceIntegrity?: { deviceRecognitionVerdict?: string[] }
}

async function decode(cfg: Config, token: string): Promise<Payload> {
  const res = await fetchWithTimeout(
    `https://playintegrity.googleapis.com/v1/${encodeURIComponent(cfg.packageName)}:decodeIntegrityToken`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${await accessToken(cfg)}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ integrity_token: token }),
    },
  )
  if (!res.ok) throw new PlayIntegrityError(`decode ${res.status}`)
  const data = (await res.json()) as { tokenPayloadExternal?: Payload }
  if (!data.tokenPayloadExternal) throw new PlayIntegrityError('decode empty')
  return data.tokenPayloadExternal
}

/** 同一个 token 只能用一次：按 token 摘要和它自己的时间戳写一行 RateLimitBucket，主键冲突即重放 */
async function claimOnce(token: string, issuedAt: number): Promise<void> {
  const key = `play-integrity:${createHash('sha256').update(token).digest('base64url')}`
  try {
    await db.rateLimitBucket.create({ data: { key, windowEnd: new Date(issuedAt + MAX_AGE_MS), count: 1 } })
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      throw new PlayIntegrityError('replayed')
    }
    throw err
  }
}

export async function verifyPlayIntegrity(token: string, opts: { action: string; email: string }): Promise<void> {
  const cfg = readConfig()
  if (!cfg) throw new PlayIntegrityError('not configured')
  if (!token || token.length > 10_000) throw new PlayIntegrityError('missing token')

  let payload: Payload
  try {
    payload = await decode(cfg, token)
  } catch (err) {
    const reason = err instanceof PlayIntegrityError ? err.reason : 'network'
    logger.warn({ reason }, 'play integrity decode failed')
    throw new PlayIntegrityError(reason)
  }

  const req = payload.requestDetails
  const app = payload.appIntegrity
  const issuedAt = Number(req?.timestampMillis)
  const checks: Array<[boolean, string]> = [
    [req?.requestPackageName === cfg.packageName, 'request package'],
    [req?.requestHash === playIntegrityRequestHash(opts.action, opts.email), 'request hash'],
    [Number.isFinite(issuedAt) && Math.abs(Date.now() - issuedAt) <= MAX_AGE_MS, 'stale'],
    [app?.appRecognitionVerdict === 'PLAY_RECOGNIZED', 'app not recognized'],
    [app?.packageName === cfg.packageName, 'app package'],
    [(app?.certificateSha256Digest ?? []).some((d) => cfg.certDigests.includes(d)), 'certificate'],
    [(payload.deviceIntegrity?.deviceRecognitionVerdict ?? []).includes('MEETS_DEVICE_INTEGRITY'), 'device'],
  ]
  const failed = checks.find(([ok]) => !ok)
  if (failed) {
    logger.warn({ reason: failed[1], action: opts.action }, 'play integrity verdict rejected')
    throw new PlayIntegrityError(failed[1])
  }
  await claimOnce(token, issuedAt)
}
