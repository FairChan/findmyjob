import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockSmtpSendEmail = vi.hoisted(() => vi.fn())
const mockResendSendEmail = vi.hoisted(() => vi.fn())
const mockResendConstructor = vi.hoisted(() => vi.fn())

vi.mock('@/env', () => ({
  env: {
    EMAIL_PROVIDER: 'smtp',
    SMTP_URL: 'smtp://smtp.example.test',
    EMAIL_FROM: 'System <system@example.test>',
    EMAIL_VERIFICATION_PROVIDER: 'resend',
    EMAIL_VERIFICATION_RESEND_API_KEY: ['verification', 'only', 'api', 'key'].join('-'),
    EMAIL_VERIFICATION_FROM: 'FindMYJob <no-reply@findmyjob.asia>',
  },
}))
vi.mock('nodemailer', () => ({
  createTransport: () => ({ sendMail: mockSmtpSendEmail, close: vi.fn() }),
}))
vi.mock('resend', () => ({
  Resend: class {
    emails = { send: mockResendSendEmail }
    constructor(apiKey: string) { mockResendConstructor(apiKey) }
  },
}))

import { createEmailProvider, type SendEmailOptions } from '@/lib/email'

const message: SendEmailOptions = {
  to: 'student@example.test',
  subject: 'Verify your FindMYJob account',
  html: '<p>Verify your account.</p>',
  text: 'Verify your account.',
}

beforeEach(() => {
  mockSmtpSendEmail.mockReset()
  mockSmtpSendEmail.mockResolvedValue({ accepted: [message.to], rejected: [] })
  mockResendSendEmail.mockReset()
  mockResendSendEmail.mockResolvedValue({ data: { id: 'verification-message' }, error: null })
  mockResendConstructor.mockReset()
})

describe('registration verification email provider isolation', () => {
  it('uses only the dedicated Resend credential and verified-domain sender for verification', async () => {
    const provider = createEmailProvider({
      provider: 'resend',
      apiKey: ['verification', 'only', 'api', 'key'].join('-'),
      from: 'FindMYJob <no-reply@findmyjob.asia>',
    })

    await expect(provider.sendEmail(message)).resolves.toBeUndefined()

    expect(mockResendConstructor).toHaveBeenCalledWith(['verification', 'only', 'api', 'key'].join('-'))
    expect(mockResendSendEmail).toHaveBeenCalledWith({
      from: 'FindMYJob <no-reply@findmyjob.asia>',
      ...message,
    })
    expect(mockSmtpSendEmail).not.toHaveBeenCalled()
  })

  it('keeps other application email on the existing SMTP configuration', async () => {
    const provider = createEmailProvider()

    await expect(provider.sendEmail({ ...message, subject: 'System notification' })).resolves.toBeUndefined()

    expect(mockSmtpSendEmail).toHaveBeenCalledWith({
      from: 'System <system@example.test>',
      to: message.to,
      subject: 'System notification',
      html: message.html,
      text: message.text,
    })
    expect(mockResendSendEmail).not.toHaveBeenCalled()
  })

  it('surfaces definitive Resend rejections without exposing provider details', async () => {
    mockResendSendEmail.mockResolvedValue({ data: null, error: {
      name: 'invalid_from_address', message: 'PRIVATE_PROVIDER_RESPONSE',
    } })
    const provider = createEmailProvider({
      provider: 'resend',
      apiKey: ['verification', 'only', 'api', 'key'].join('-'),
      from: 'FindMYJob <no-reply@findmyjob.asia>',
    })

    const error = await provider.sendEmail(message).then(() => null, caught => caught)

    expect(error).toMatchObject({ outcome: 'not-accepted' })
    expect(String(error)).not.toContain('PRIVATE_PROVIDER_RESPONSE')
  })
})
