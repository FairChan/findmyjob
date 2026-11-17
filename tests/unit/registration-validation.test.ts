import { describe, expect, it } from 'vitest'
import { firstInvalidField, validateRegistration } from '@/components/auth/registration-validation'

const valid = { name: '张同学', email: 'student@example.test', password: 'abcdefgh', agreeTerms: true, agreePrivacy: true }

describe('validateRegistration', () => {
  it('accepts a complete form', () => {
    expect(validateRegistration(valid)).toEqual({})
  })

  it('reports every empty field separately', () => {
    const errors = validateRegistration({ name: ' ', email: '', password: '', agreeTerms: false, agreePrivacy: false })
    expect(errors).toEqual({
      name: 'errorRequired',
      email: 'errorRequired',
      password: 'errorRequired',
      agreeTerms: 'errorMustAgree',
      agreePrivacy: 'errorMustAgree',
    })
    expect(firstInvalidField(errors)).toBe('name')
  })

  it('names the real problem for a filled but invalid field', () => {
    expect(validateRegistration({ ...valid, password: 'short' })).toEqual({ password: 'errorPasswordTooShort' })
    expect(validateRegistration({ ...valid, email: 'not-an-email' })).toEqual({ email: 'errorInvalidEmail' })
    expect(validateRegistration({ ...valid, password: 'x'.repeat(129) })).toEqual({ password: 'errorPasswordTooLong' })
  })

  it('points focus at the first invalid field in form order', () => {
    expect(firstInvalidField(validateRegistration({ ...valid, agreePrivacy: false, password: '1' }))).toBe('password')
    expect(firstInvalidField({})).toBeNull()
  })
})
