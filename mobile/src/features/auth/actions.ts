import type { HumanCheckAction } from '@shared/mobile-api'

import { revokeThisDevice } from '@/features/push/push'
import { apiBaseUrl } from '@/lib/api-config'
import { authClient, clearLocalSession } from '@/lib/auth-client'
import { clearPersistedQueries } from '@/lib/query-persist'
import type { HumanProof } from './human-check'

export type RequestProof = (action: HumanCheckAction, email: string, opts?: { forceTurnstile?: boolean }) => Promise<HumanProof>

export class AuthActionError extends Error {
  constructor(public readonly code: string) {
    super(code)
    this.name = 'AuthActionError'
  }
}

type BaResult = { error?: { code?: string; status?: number } | null; data?: unknown }

/**
 * 先用 Play Integrity；服务端若判为 TURNSTILE_FAILED（直装 APK、服务端未配置等），
 * 同一操作改走 Turnstile 再试一次。其余错误原样抛出。
 */
async function withHumanCheck(
  requestProof: RequestProof,
  action: HumanCheckAction,
  email: string,
  call: (proof: HumanProof) => Promise<BaResult>,
): Promise<unknown> {
  let proof = await requestProof(action, email)
  let res = await call(proof)
  if (res.error?.code === 'TURNSTILE_FAILED' && 'integrityToken' in proof) {
    proof = await requestProof(action, email, { forceTurnstile: true })
    res = await call(proof)
  }
  if (res.error) throw new AuthActionError(res.error.code ?? (res.error.status === 429 ? 'RATE_LIMITED' : 'generic'))
  return res.data
}

/** 回调地址一律用网页的 https 绝对地址：自定义 scheme 会被服务端拒绝（防 Cookie 进 URL，见 MA1-T02） */
export function webUrl(path: string): string {
  return `${apiBaseUrl()}${path}`
}

export function verificationCallbackUrl(locale: string): string {
  return webUrl(`/${locale === 'en' ? 'en' : 'zh'}/login?verified=1`)
}

export async function signInWithEmail(requestProof: RequestProof, input: { email: string; password: string }) {
  return withHumanCheck(requestProof, 'login', input.email, (proof) =>
    authClient.signIn.email({ email: input.email, password: input.password, ...proof } as Parameters<typeof authClient.signIn.email>[0]),
  )
}

export async function signUpStudent(
  requestProof: RequestProof,
  input: { name: string; email: string; password: string; agreeTerms: boolean; agreePrivacy: boolean; joinTalentPool: boolean; locale: string },
) {
  return withHumanCheck(requestProof, 'register', input.email, (proof) =>
    authClient.signUp.email({
      name: input.name,
      email: input.email,
      password: input.password,
      agreeTerms: input.agreeTerms,
      agreePrivacy: input.agreePrivacy,
      joinTalentPool: input.joinTalentPool,
      callbackURL: verificationCallbackUrl(input.locale),
      ...proof,
    } as unknown as Parameters<typeof authClient.signUp.email>[0]),
  )
}

export async function resendVerification(requestProof: RequestProof, input: { email: string; locale: string }) {
  return withHumanCheck(requestProof, 'send-verification', input.email, (proof) =>
    authClient.sendVerificationEmail({ email: input.email, callbackURL: verificationCallbackUrl(input.locale), ...proof } as Parameters<
      typeof authClient.sendVerificationEmail
    >[0]),
  )
}

export async function requestPasswordReset(requestProof: RequestProof, input: { email: string; locale: string }) {
  return withHumanCheck(requestProof, 'forgot-password', input.email, (proof) =>
    authClient.requestPasswordReset({
      email: input.email,
      redirectTo: webUrl(`/${input.locale === 'en' ? 'en' : 'zh'}/reset-password`),
      ...proof,
    } as Parameters<typeof authClient.requestPasswordReset>[0]),
  )
}

/**
 * 唯一的退出登录入口：先尽力通知服务端吊销会话（失败也不管），本机凭据无论如何都要清掉。
 * 不抛错：调用方接着清查询缓存、回欢迎页即可。
 * TODO(MA3-T01)：在清本机凭据之前，先吊销这台设备的推送 token（DELETE /devices/:id）。
 */
export async function signOut(): Promise<void> {
  try {
    // 先注销本机推送 token（要带着还有效的 Cookie）；失败无妨，服务端删会话时 token 会级联删除
    await revokeThisDevice().catch(() => {})
    await authClient.signOut()
  } catch {
    // 离线、5xx、会话已被服务端吊销（注销账号后）都会走到这里
  } finally {
    await clearLocalSession()
    await clearPersistedQueries()
  }
}
