import { describe, expect, it } from 'vitest'
import { findUnsafeCallbackUrl } from '@/server/lib/auth-callback-url'

describe('findUnsafeCallbackUrl (MA1-T02)', () => {
  it.each([
    [{ callbackURL: '/zh/register/verify-email?verified=1' }],
    [{ callbackURL: 'https://findmyjob.asia/zh' }],
    [{ callbackURL: 'http://localhost:3000/en' }],
    [{ callbackURL: '' }],
    [{}],
    [undefined],
  ])('accepts %j', (body) => {
    expect(findUnsafeCallbackUrl(body)).toBeNull()
  })

  it.each([
    [{ callbackURL: 'findmyjob://verified' }, 'callbackURL'],
    [{ callbackURL: 'findmyjob-dev://x' }, 'callbackURL'],
    [{ newUserCallbackURL: 'exp://127.0.0.1:8081' }, 'newUserCallbackURL'],
    [{ errorCallbackURL: 'javascript:alert(1)' }, 'errorCallbackURL'],
    [{ redirectTo: '//evil.example/x' }, 'redirectTo'],
    [{ redirectTo: '/\\evil.example' }, 'redirectTo'],
    [{ callbackURL: 'not a url' }, 'callbackURL'],
    [{ callbackURL: 42 }, 'callbackURL'],
  ])('rejects %j', (body, field) => {
    expect(findUnsafeCallbackUrl(body as Record<string, unknown>)).toBe(field)
  })
})
