import { beforeEach, describe, expect, it, vi } from 'vitest'
const io = vi.hoisted(() => ({ sendMail: vi.fn(), close: vi.fn() }))
vi.mock('@/env', () => ({ env: { EMAIL_PROVIDER: 'smtp', SMTP_URL: 'smtp://synthetic.invalid', EMAIL_FROM: 'weekly@example.test' } }))
vi.mock('nodemailer', () => ({ createTransport: () => ({ sendMail: io.sendMail, close: io.close }) }))
import { createEmailProvider } from '@/lib/email'

const message = { to: 'recipient@example.test', subject: 'Synthetic', html: '<p>Test</p>', text: 'Test' }
const rejected = (extra: Record<string, unknown> = {}) => Object.assign(new Error('PRIVATE_SMTP_RESPONSE'), {
  code: 'EENVELOPE', command: 'RCPT TO', responseCode: 450, rejected: [message.to], ...extra,
})
beforeEach(() => vi.resetAllMocks())
describe('T04 actual Nodemailer rejection shapes', () => {
  it.each([450, 550])('recognizes complete single-recipient RCPT rejection %s before DATA', async responseCode => {
    io.sendMail.mockRejectedValue(rejected({ responseCode }))
    const error = await createEmailProvider().sendEmail(message).catch(error => error)
    expect(error).toMatchObject({ name: 'EmailDeliveryError', outcome: 'not-accepted' })
    expect(String(error)).not.toContain('PRIVATE_SMTP_RESPONSE')
    expect(io.sendMail).toHaveBeenCalledOnce()
    expect(io.close).toHaveBeenCalledOnce()
  })
  it.each([
    { command: 'DATA' }, { command: undefined }, { responseCode: undefined }, { responseCode: '450' },
    { responseCode: 250 }, { rejected: ['other@example.test'] }, { rejected: [message.to, 'other@example.test'] },
    { accepted: [message.to] }, { accepted: 'invalid' }, { code: 'ECONNECTION' },
  ])('keeps partial, contradictory and non-RCPT evidence unknown: %#', async override => {
    io.sendMail.mockRejectedValue(rejected(override))
    await expect(createEmailProvider().sendEmail(message)).rejects.toMatchObject({ outcome: 'unknown' })
    expect(io.sendMail).toHaveBeenCalledOnce()
  })
})
