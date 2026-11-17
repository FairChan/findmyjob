import { describe, expect, it } from 'vitest'
import { verificationCallbackPath, verificationOutcome } from '@/lib/email-verification'

describe('verificationCallbackPath', () => {
  it('lands on the localized login page', () => {
    expect(verificationCallbackPath('zh')).toBe('/zh/login?verified=1')
    expect(verificationCallbackPath('en')).toBe('/en/login?verified=1')
    expect(verificationCallbackPath('https://evil.example')).toBe('/zh/login?verified=1')
  })
})

describe('verificationOutcome', () => {
  it('reads the redirect Better Auth makes after the link is opened', () => {
    expect(verificationOutcome({ verified: '1' })).toBe('verified')
    expect(verificationOutcome({ verified: '1', error: 'TOKEN_EXPIRED' })).toBe('expired')
    expect(verificationOutcome({ verified: '1', error: 'INVALID_TOKEN' })).toBe('invalid')
    expect(verificationOutcome({ verified: ['1'], error: ['token_expired'] })).toBe('expired')
  })

  it('ignores a login page that was not reached from a verification link', () => {
    expect(verificationOutcome({})).toBeNull()
    expect(verificationOutcome({ error: 'TOKEN_EXPIRED' })).toBeNull()
  })
})
