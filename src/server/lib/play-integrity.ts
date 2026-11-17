import 'server-only'
import { createHash } from 'crypto'
import { Prisma } from '@prisma/client'
import { db } from '../db'
import { playIntegrityHashInput } from '@/shared/mobile-api'
import { logger } from './logger'
import { getGoogleAccessToken, GoogleAuthError, resetGoogleTokenCache } from './google-oauth'

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
  return createHash('sha256').update(playIntegrityHashInput(action, email)).digest('base64url')
}

// Google OAuth 由 google-oauth.ts 统一处理（FCM 也用它）
export function resetPlayIntegrityTokenCache(): void {
  resetGoogleTokenCache()
}

async function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
  return fetch(url, { ...init, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })
}

async function accessToken(): Promise<string> {
  try {
    return await getGoogleAccessToken(SCOPE)
  } catch (err) {
    throw new PlayIntegrityError(err instanceof GoogleAuthError ? err.reason : 'oauth')
  }
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
      headers: { Authorization: `Bearer ${await accessToken()}`, 'Content-Type': 'application/json' },
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
