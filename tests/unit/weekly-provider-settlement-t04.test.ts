import { afterEach, beforeEach, expect, it, vi } from 'vitest'
const io = vi.hoisted(() => ({ send: vi.fn(), close: vi.fn(), env: { EMAIL_PROVIDER: 'smtp', SMTP_URL: 'smtp://synthetic.invalid', RESEND_API_KEY: 'synthetic-only', EMAIL_FROM: 'from@example.test' } }))
vi.mock('@/env', () => ({ env: io.env }))
vi.mock('nodemailer', () => ({ createTransport: () => ({ sendMail: io.send, close: io.close }) }))
vi.mock('resend', () => ({ Resend: class { emails = { send: io.send } } }))
import { createEmailProvider } from '@/lib/email'
beforeEach(() => { io.send.mockReset(); io.close.mockReset(); vi.useFakeTimers() })
afterEach(() => vi.useRealTimers())
it.each(['smtp', 'resend'])('%s deadline reports UNKNOWN but weekly owner can wait actual settlement', async kind => {
  io.env.EMAIL_PROVIDER = kind
  let release!: (value: unknown) => void
  const held = new Promise(resolve => { release = resolve })
  io.send.mockReturnValueOnce(held)
  const provider = createEmailProvider()
  const outcome = expect(provider.sendEmail({ to: 'recipient@example.test', subject: 'Synthetic', html: '<p>Synthetic</p>' })).rejects.toMatchObject({ outcome: 'unknown' })
  // The provider imports its SDK before starting the deadline. Wait for actual
  // dispatch so a cold module transform cannot begin the timer after our tick.
  await vi.waitFor(() => expect(io.send).toHaveBeenCalledOnce())
  await vi.advanceTimersByTimeAsync(20_001)
  await outcome
  expect(provider.settle).toBeTypeOf('function')
  let settled = false
  const settling = provider.settle!().then(() => { settled = true })
  await Promise.resolve()
  expect(settled).toBe(false)
  release(kind === 'smtp' ? { accepted: ['recipient@example.test'], rejected: [] } : { data: { id: 'synthetic-ack' }, error: null })
  await settling
  expect(settled).toBe(true)
  expect(io.send).toHaveBeenCalledOnce()
})
