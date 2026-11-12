import { beforeEach, describe, expect, it, vi } from 'vitest'
const send = vi.hoisted(() => vi.fn())
vi.mock('@/env', () => ({ env: { EMAIL_PROVIDER: 'resend', RESEND_API_KEY: 'synthetic-key', EMAIL_FROM: 'weekly@example.test' } }))
vi.mock('resend', () => ({ Resend: class { emails = { send } } }))
import { createEmailProvider } from '@/lib/email'

const message = { to: 'recipient@example.test', subject: 'Synthetic weekly digest', html: '<p>Synthetic</p>', text: 'Synthetic' }
beforeEach(() => { send.mockReset() })

describe('M9-T04 actual Resend adapter acknowledgement', () => {
  it('does not treat a resolved provider error as acceptance', async () => {
    send.mockResolvedValue({ data: null, error: { name: 'validation_error', message: 'PRIVATE_PROVIDER_RESPONSE' } })
    await expect(createEmailProvider().sendEmail(message)).rejects.toMatchObject({ outcome: 'not-accepted' })
    expect(send).toHaveBeenCalledOnce()
  })
  it('classifies thrown transport outcomes as unknown without leaking raw details', async () => {
    send.mockRejectedValue(new Error('PRIVATE_PROVIDER_RESPONSE'))
    const error = await createEmailProvider().sendEmail(message).then(() => null, caught => caught)
    expect(error).toMatchObject({ outcome: 'unknown' })
    expect(String(error)).not.toContain('PRIVATE_PROVIDER_RESPONSE')
    expect(send).toHaveBeenCalledOnce()
  })
  it('accepts a real-shaped positive provider acknowledgement once', async () => {
    send.mockResolvedValue({ data: { id: 'synthetic-provider-message' }, error: null })
    await expect(createEmailProvider().sendEmail(message)).resolves.toBeUndefined()
    expect(send).toHaveBeenCalledOnce()
    expect(send.mock.calls[0][0]).toMatchObject({ to: message.to, subject: message.subject })
  })
})
