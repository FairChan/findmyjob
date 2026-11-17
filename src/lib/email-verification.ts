// Where the verification link lands. A fixed, same-origin path: Better Auth appends `error=...`
// to it when the token is invalid or expired, and the login page explains either outcome.
export function verificationCallbackPath(locale: string): string {
  return `/${locale === 'en' ? 'en' : 'zh'}/login?verified=1`
}

export type VerificationOutcome = 'verified' | 'expired' | 'invalid' | null

export function verificationOutcome(params: { verified?: string | string[]; error?: string | string[] }): VerificationOutcome {
  const error = Array.isArray(params.error) ? params.error[0] : params.error
  const verified = Array.isArray(params.verified) ? params.verified[0] : params.verified
  if (verified !== '1') return null
  if (!error) return 'verified'
  return error.toUpperCase() === 'TOKEN_EXPIRED' ? 'expired' : 'invalid'
}
