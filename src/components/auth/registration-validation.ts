// Client-side pre-check for the registration forms. The server re-validates with zod; this exists
// so the user sees which field is wrong and why, instead of one generic message after a round trip.

export type RegistrationField = 'name' | 'email' | 'password' | 'agreeTerms' | 'agreePrivacy'
export type RegistrationErrorKey =
  | 'errorRequired'
  | 'errorInvalidEmail'
  | 'errorPasswordTooShort'
  | 'errorPasswordTooLong'
  | 'errorMustAgree'

export interface RegistrationInput {
  name: string
  email: string
  password: string
  agreeTerms: boolean
  agreePrivacy: boolean
}

export const REGISTRATION_FIELD_ORDER: RegistrationField[] = ['name', 'email', 'password', 'agreeTerms', 'agreePrivacy']

// Same rules as the server schema in src/server/actions/register.ts.
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function validateRegistration(input: RegistrationInput): Partial<Record<RegistrationField, RegistrationErrorKey>> {
  const errors: Partial<Record<RegistrationField, RegistrationErrorKey>> = {}
  if (!input.name.trim()) errors.name = 'errorRequired'
  else if (input.name.trim().length > 100) errors.name = 'errorRequired'
  if (!input.email.trim()) errors.email = 'errorRequired'
  else if (!EMAIL_PATTERN.test(input.email.trim())) errors.email = 'errorInvalidEmail'
  if (!input.password) errors.password = 'errorRequired'
  else if (input.password.length < 8) errors.password = 'errorPasswordTooShort'
  else if (input.password.length > 128) errors.password = 'errorPasswordTooLong'
  if (!input.agreeTerms) errors.agreeTerms = 'errorMustAgree'
  if (!input.agreePrivacy) errors.agreePrivacy = 'errorMustAgree'
  return errors
}

export function firstInvalidField(errors: Partial<Record<RegistrationField, unknown>>): RegistrationField | null {
  return REGISTRATION_FIELD_ORDER.find((field) => errors[field]) ?? null
}
