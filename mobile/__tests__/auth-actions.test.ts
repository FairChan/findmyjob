import { createHash } from 'crypto'

import { playIntegrityHashInput } from '@shared/mobile-api'

import { AuthActionError, signInWithEmail, signUpStudent, verificationCallbackUrl } from '@/features/auth/actions'
import { toBase64Url } from '@/features/auth/human-check'

jest.mock('expo-constants', () => ({
  __esModule: true,
  default: { expoConfig: { version: '0.1.0', scheme: 'findmyjob-dev', extra: { apiBaseUrl: 'https://findmyjob.asia' } } },
}))
const mockSignIn = jest.fn()
const mockSignUp = jest.fn()
jest.mock('@/lib/auth-client', () => ({
  authClient: {
    signIn: { email: (...a: unknown[]) => mockSignIn(...a) },
    signUp: { email: (...a: unknown[]) => mockSignUp(...a) },
  },
}))
jest.mock('@expo/app-integrity', () => ({}))
jest.mock('react-native-webview', () => ({ WebView: () => null }))

beforeEach(() => {
  mockSignIn.mockReset()
  mockSignUp.mockReset()
})

describe('human check retry', () => {
  it('uses the integrity token when the server accepts it', async () => {
    const proof = jest.fn().mockResolvedValue({ integrityToken: 'it' })
    mockSignIn.mockResolvedValue({ data: { user: {} }, error: null })
    await signInWithEmail(proof, { email: 'a@example.test', password: 'pw-123456' })
    expect(proof).toHaveBeenCalledTimes(1)
    expect(mockSignIn).toHaveBeenCalledWith(expect.objectContaining({ integrityToken: 'it' }))
  })

  it('falls back to Turnstile once when the integrity verdict is rejected', async () => {
    const proof = jest.fn().mockResolvedValueOnce({ integrityToken: 'it' }).mockResolvedValueOnce({ turnstileToken: 'tt' })
    mockSignIn.mockResolvedValueOnce({ error: { code: 'TURNSTILE_FAILED', status: 400 } }).mockResolvedValueOnce({ data: {}, error: null })
    await signInWithEmail(proof, { email: 'a@example.test', password: 'pw-123456' })
    expect(proof).toHaveBeenLastCalledWith('login', 'a@example.test', { forceTurnstile: true })
    expect(mockSignIn).toHaveBeenLastCalledWith(expect.objectContaining({ turnstileToken: 'tt' }))
  })

  it('does not loop when Turnstile itself fails, and surfaces other codes', async () => {
    const proof = jest.fn().mockResolvedValue({ turnstileToken: 'tt' })
    mockSignIn.mockResolvedValue({ error: { code: 'TURNSTILE_FAILED', status: 400 } })
    await expect(signInWithEmail(proof, { email: 'a@example.test', password: 'x' })).rejects.toEqual(new AuthActionError('TURNSTILE_FAILED'))
    expect(mockSignIn).toHaveBeenCalledTimes(1)
    mockSignIn.mockResolvedValue({ error: { status: 429 } })
    await expect(signInWithEmail(proof, { email: 'a@example.test', password: 'x' })).rejects.toEqual(new AuthActionError('RATE_LIMITED'))
  })

  it('sign-up sends consents and an https callback (never a custom scheme)', async () => {
    const proof = jest.fn().mockResolvedValue({ turnstileToken: 'tt' })
    mockSignUp.mockResolvedValue({ data: {}, error: null })
    await signUpStudent(proof, { name: 'A', email: 'a@example.test', password: 'pw-123456', agreeTerms: true, agreePrivacy: true, joinTalentPool: false, locale: 'en' })
    const body = mockSignUp.mock.calls[0][0]
    expect(body).toMatchObject({ agreeTerms: true, agreePrivacy: true, joinTalentPool: false, turnstileToken: 'tt' })
    expect(body.callbackURL).toBe('https://findmyjob.asia/en/login?verified=1')
    expect(verificationCallbackUrl('ms')).toBe('https://findmyjob.asia/zh/login?verified=1')
  })
})

describe('integrity request hash', () => {
  it('matches the server: base64url(sha256(shared input))', () => {
    const b64 = createHash('sha256').update(playIntegrityHashInput('login', ' A@Example.test ')).digest('base64')
    const server = createHash('sha256').update(playIntegrityHashInput('login', 'a@example.test')).digest('base64url')
    expect(toBase64Url(b64)).toBe(server)
  })
})
