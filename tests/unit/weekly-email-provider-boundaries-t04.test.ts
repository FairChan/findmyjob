import { beforeEach, describe, expect, it, vi } from 'vitest'
const io = vi.hoisted(() => ({ send: vi.fn(), sendMail: vi.fn(), close: vi.fn(), provider: 'resend' }))
vi.mock('@/env', () => ({ env: { get EMAIL_PROVIDER() { return io.provider }, RESEND_API_KEY: 'synthetic', SMTP_URL: 'smtp://synthetic.invalid', EMAIL_FROM: 'weekly@example.test' } }))
vi.mock('resend', () => ({ Resend: class { emails = { send: io.send } } }))
vi.mock('nodemailer', () => ({ createTransport: () => ({ sendMail: io.sendMail, close: io.close }) }))
import { createEmailProvider } from '@/lib/email'
const message = { to: 'recipient@example.test', subject: 'Synthetic', html: '<p>Test</p>', text: 'Test' }
beforeEach(() => { vi.resetAllMocks(); io.provider = 'resend' })
describe('T04 acknowledged provider boundaries', () => {
  it.each([{ data: null, error: null }, { data: { id: '' }, error: null }, { data: null, error: { name: 'internal_server_error', message: 'PRIVATE' } }])('rejects ambiguous Resend result %#', async result => {
    io.send.mockResolvedValue(result)
    await expect(createEmailProvider().sendEmail(message)).rejects.toMatchObject({ outcome: 'unknown' })
  })
  it('does not automatically retry a timed-out provider request', async () => {
    vi.useFakeTimers()
    try {
      io.send.mockReturnValue(new Promise(() => {}))
      const outcome = createEmailProvider().sendEmail(message).catch(error => error)
      await vi.advanceTimersByTimeAsync(20_001)
      expect(await outcome).toMatchObject({ outcome: 'unknown' })
      expect(io.send).toHaveBeenCalledOnce()
    } finally { vi.useRealTimers() }
  })
  it('requires SMTP acceptance for the actual single recipient', async () => {
    io.provider = 'smtp'; io.sendMail.mockResolvedValue({ accepted: ['elsewhere@example.test'], rejected: [] })
    await expect(createEmailProvider().sendEmail(message)).rejects.toMatchObject({ outcome: 'unknown' })
    expect(io.close).toHaveBeenCalledOnce()
  })
  it('accepts one SMTP recipient and classifies a complete explicit rejection', async () => {
    io.provider = 'smtp'; io.sendMail.mockResolvedValueOnce({ accepted: [message.to], rejected: [] }).mockResolvedValueOnce({ accepted: [], rejected: [message.to] })
    await expect(createEmailProvider().sendEmail(message)).resolves.toBeUndefined()
    await expect(createEmailProvider().sendEmail(message)).rejects.toMatchObject({ outcome: 'not-accepted' })
    expect(io.close).toHaveBeenCalledTimes(2)
  })
  it('sanitizes generic SMTP errors as unknown', async () => {
    io.provider = 'smtp'; io.sendMail.mockRejectedValue(new Error('PRIVATE_ADDRESS_AND_SMTP_RESPONSE'))
    const error = await createEmailProvider().sendEmail(message).catch(error => error)
    expect(error).toMatchObject({ outcome: 'unknown' })
    expect(String(error)).not.toContain('PRIVATE_ADDRESS_AND_SMTP_RESPONSE')
  })
})
