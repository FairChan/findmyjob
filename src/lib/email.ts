import 'server-only'
import { env } from '@/env'

export interface SendEmailOptions { to: string; subject: string; html: string; text?: string }
export interface EmailProvider { sendEmail(opts: SendEmailOptions): Promise<void>; settle?(): Promise<void> }
export interface EmailProviderOverrides {
  provider?: 'smtp' | 'resend'
  apiKey?: string
  from?: string
}
export class EmailDeliveryError extends Error {
  constructor(public readonly outcome: 'not-accepted' | 'unknown') {
    super(outcome === 'not-accepted' ? 'Email was not accepted' : 'Email outcome is unknown')
    this.name = 'EmailDeliveryError'
  }
}
async function settlePending(pending: Set<Promise<unknown>>): Promise<void> {
  while (pending.size) await Promise.allSettled([...pending])
}
async function deadline<T>(work: Promise<T>, pending: Set<Promise<unknown>>): Promise<T> {
  pending.add(work)
  void work.then(() => pending.delete(work), () => pending.delete(work))
  let timer: ReturnType<typeof setTimeout>
  try { return await Promise.race([work, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new EmailDeliveryError('unknown')), 20_000) })]) }
  finally { clearTimeout(timer!) }
}
function isRejectedSmtpRecipient(error: unknown, recipient: string): boolean {
  if (error === null || typeof error !== 'object') return false
  const failure = error as Record<string, unknown>
  // Nodemailer rejects when every RCPT TO fails before sending message content.
  // Require the complete single-recipient shape; never infer this from a code alone.
  return failure.code === 'EENVELOPE' && failure.command === 'RCPT TO' &&
    typeof failure.responseCode === 'number' && Number.isInteger(failure.responseCode) &&
    failure.responseCode >= 400 && failure.responseCode <= 599 &&
    Array.isArray(failure.rejected) && failure.rejected.length === 1 &&
    typeof failure.rejected[0] === 'string' && failure.rejected[0].toLowerCase() === recipient.toLowerCase() &&
    (failure.accepted === undefined || (Array.isArray(failure.accepted) && failure.accepted.length === 0))
}
class SmtpEmailProvider implements EmailProvider {
  constructor(private readonly from = env.EMAIL_FROM) {}
  private readonly pending = new Set<Promise<unknown>>()
  async settle(): Promise<void> { await settlePending(this.pending) }
  async sendEmail(opts: SendEmailOptions): Promise<void> {
    let close: (() => void) | undefined
    try {
      const nodemailer = await import('nodemailer')
      const transport = nodemailer.createTransport({ url: env.SMTP_URL!, connectionTimeout: 10_000, greetingTimeout: 10_000, socketTimeout: 15_000 })
      close = () => transport.close()
      const result = await deadline(transport.sendMail({ from: this.from, to: opts.to, subject: opts.subject, html: opts.html, text: opts.text }), this.pending)
      const accepted = result.accepted ?? []
      if (accepted.length === 1 && typeof accepted[0] === 'string' && accepted[0].toLowerCase() === opts.to.toLowerCase()) return
      throw new EmailDeliveryError(accepted.length === 0 && (result.rejected?.length ?? 0) > 0 ? 'not-accepted' : 'unknown')
    } catch (error) {
      if (error instanceof EmailDeliveryError) throw error
      // Authentication failure precedes DATA. All unproven transport failures
      // (including a disconnect after DATA) remain ambiguous.
      const authenticationRejected = error !== null && typeof error === 'object' && 'code' in error && error.code === 'EAUTH'
      throw new EmailDeliveryError(authenticationRejected || isRejectedSmtpRecipient(error, opts.to) ? 'not-accepted' : 'unknown')
    } finally { close?.() }
  }
}
class ResendEmailProvider implements EmailProvider {
  private readonly pending = new Set<Promise<unknown>>()
  constructor(private readonly apiKey = env.RESEND_API_KEY!, private readonly from = env.EMAIL_FROM) {}
  async settle(): Promise<void> { await settlePending(this.pending) }
  async sendEmail(opts: SendEmailOptions): Promise<void> {
    try {
      const { Resend } = await import('resend')
      const resend = new Resend(this.apiKey)
      const result = await deadline(resend.emails.send({ from: this.from, to: opts.to, subject: opts.subject, html: opts.html, text: opts.text }), this.pending)
      if (result.error) {
        const definiteRejection = new Set(['validation_error', 'missing_required_field', 'invalid_access', 'invalid_api_key',
          'restricted_api_key', 'invalid_from_address', 'rate_limit_exceeded', 'daily_quota_exceeded', 'monthly_quota_exceeded'])
        throw new EmailDeliveryError(definiteRejection.has(result.error.name) ? 'not-accepted' : 'unknown')
      }
      if (!result.data || typeof result.data.id !== 'string' || !result.data.id.trim()) throw new EmailDeliveryError('unknown')
    } catch (error) {
      throw error instanceof EmailDeliveryError ? error : new EmailDeliveryError('unknown')
    }
  }
}
export function createEmailProvider(overrides: EmailProviderOverrides = {}): EmailProvider {
  const provider = overrides.provider ?? env.EMAIL_PROVIDER
  switch (provider) {
    case 'resend': return new ResendEmailProvider(overrides.apiKey, overrides.from)
    case 'smtp': default: return new SmtpEmailProvider(overrides.from)
  }
}
