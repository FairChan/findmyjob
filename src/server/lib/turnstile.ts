import 'server-only'
import { env } from '@/env'

interface SiteverifyResponse {
  success: boolean
  hostname?: string
  action?: string
  'error-codes'?: string[]
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
    result = (await res.json()) as SiteverifyResponse
  } catch {
    throw new TurnstileError('Turnstile verification timed out or network error')
  }

  if (!result.success) {
    throw new TurnstileError('Turnstile verification failed')
  }

  const expectedHostname = new URL(env.APP_URL).hostname
  if (result.hostname && result.hostname !== expectedHostname) {
    throw new TurnstileError(`Turnstile hostname mismatch: got ${result.hostname}`)
  }

  if (result.action && result.action !== action) {
    throw new TurnstileError(`Turnstile action mismatch: got ${result.action}, expected ${action}`)
  }
}
