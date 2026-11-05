import 'server-only'
import { env } from '@/env'

interface SiteverifyResponse {
  success: boolean
  hostname?: string
  action?: string
  'error-codes'?: string[]
  metadata?: { result_with_testing_key?: boolean }
}

// https://developers.cloudflare.com/turnstile/troubleshooting/testing/
const TEST_SECRET_RESULTS: Record<string, 'pass' | 'fail' | 'duplicate'> = {
  '1x0000000000000000000000000000000AA': 'pass',
  '2x0000000000000000000000000000000AA': 'fail',
  '3x0000000000000000000000000000000AA': 'duplicate',
}

export class TurnstileError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'TurnstileError'
  }
}

/**
 * Verifies a Cloudflare Turnstile token server-side.
 * Validates success, hostname, and action; treats timeout as failure.
 * Token single-use is enforced by Cloudflare automatically.
 */
export async function verifyTurnstile(
  token: string,
  { action, ip }: { action: string; ip?: string | null },
): Promise<void> {
  if (!token || typeof token !== 'string') {
    throw new TurnstileError('Missing Turnstile token')
  }

  // Cloudflare 公开的测试 secret 对任何 token 的结果是固定的（1x 必过，2x 必败，3x 视为重复使用）。
  // 非生产环境用它们时不走网络：本机连 Cloudflare 时快时慢，5 秒超时会让 E2E 随机失败（2026-11-05 实测）。
  // 生产环境 env.ts 本来就禁止测试 secret，这里也不走捷径。
  if (env.APP_ENV !== 'production') {
    const fixed = TEST_SECRET_RESULTS[env.TURNSTILE_SECRET_KEY]
    if (fixed === 'pass') return
    if (fixed) throw new TurnstileError(`Turnstile verification failed (test secret: ${fixed})`)
  }

  const params = new URLSearchParams({
    secret: env.TURNSTILE_SECRET_KEY,
    response: token,
  })
  if (ip) {
    params.append('remoteip', ip)
  }

  let result: SiteverifyResponse
  try {
    const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
      signal: AbortSignal.timeout(5000),
    })
    if (!res.ok) {
      throw new TurnstileError(`Turnstile siteverify returned HTTP ${res.status}`)
    }
    result = (await res.json()) as SiteverifyResponse
  } catch (e) {
    if (e instanceof TurnstileError) throw e
    throw new TurnstileError('Turnstile verification timed out or network error')
  }

  if (!result.success) {
    throw new TurnstileError('Turnstile verification failed')
  }

  const strict = env.APP_ENV === 'production'
  // Cloudflare 测试密钥的结果固定是 hostname=example.com、没有 action，并带 result_with_testing_key 标记。
  // 非生产环境（本地、CI）认这个标记、跳过两项比对；生产环境见到它一律拒绝（env.ts 另外禁止生产用测试密钥）
  if (result.metadata?.result_with_testing_key === true) {
    if (strict) throw new TurnstileError('Turnstile testing-key result rejected in production')
    return
  }

  // 生产环境缺字段也算失败；非生产环境只在字段存在时比对
  const expectedHostname = new URL(env.APP_URL).hostname
  if ((strict || result.hostname) && result.hostname !== expectedHostname) {
    throw new TurnstileError(`Turnstile hostname mismatch: got ${result.hostname ?? '(none)'}`)
  }

  if ((strict || result.action) && result.action !== action) {
    throw new TurnstileError(`Turnstile action mismatch: got ${result.action ?? '(none)'}, expected ${action}`)
  }
}
