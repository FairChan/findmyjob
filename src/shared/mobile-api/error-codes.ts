// 服务端 AppError 的 code（src/server/errors.ts 和各 service 里抛出的），
// App 按这里的 code 显示文案；不在表里的 code 一律显示通用错误。
// 新增 AppError code 时，如果 App 会遇到，就加到这里并补 messages 的 mobile.errors.*。
export const MOBILE_ERROR_CODES = [
  // 协议层（route() 和移动端约定）
  'INVALID_JSON',
  'VALIDATION_ERROR',
  'FORBIDDEN',
  'UNAUTHORIZED',
  'NOT_FOUND',
  'CONFLICT',
  'RATE_LIMITED',
  'INTERNAL_ERROR',
  'APP_UPDATE_REQUIRED',
  'NEEDS_RECONSENT',
  // 认证与账号
  'TWO_FACTOR_REQUIRED',
  'FRESH_SESSION_REQUIRED',
  'SIGNUP_CLOSED',
  'TURNSTILE_FAILED',
  'REGISTER_FAILED',
  // 业务
  'FEATURE_DISABLED',
  'VERSION_MISMATCH',
  'DUPLICATE_APPLICATION',
  'COMPLETENESS_LOW',
  'CONTACT_REQUIRED',
  'RESUME_REQUIRED',
  'INVITATION_QUOTA_EXCEEDED',
  'INSUFFICIENT_CREDITS',
  'RESUME_PARSE_JOB_FAILED',
  'AI_UNAVAILABLE',
] as const

export type MobileErrorCode = (typeof MOBILE_ERROR_CODES)[number]

export function isKnownMobileErrorCode(code: string): code is MobileErrorCode {
  return (MOBILE_ERROR_CODES as readonly string[]).includes(code)
}
