import { env } from '@/env'

export interface SendEmailOptions {
  to: string
  subject: string
  html: string
  text?: string
}

export interface EmailProvider {
  sendEmail(opts: SendEmailOptions): Promise<void>
}

class SmtpEmailProvider implements EmailProvider {
  async sendEmail(opts: SendEmailOptions): Promise<void> {
    const nodemailer = await import('nodemailer')
    const transport = nodemailer.createTransport(env.SMTP_URL!)
    await transport.sendMail({
      from: env.EMAIL_FROM,
      to: opts.to,
      subject: opts.subject,
      html: opts.html,
      text: opts.text,
    })
  }
}

class ResendEmailProvider implements EmailProvider {
  async sendEmail(opts: SendEmailOptions): Promise<void> {
    const { Resend } = await import('resend')
    const resend = new Resend(env.RESEND_API_KEY!)
    await resend.emails.send({
      from: env.EMAIL_FROM,
      to: opts.to,
      subject: opts.subject,
      html: opts.html,
      text: opts.text,
    })
  }
}

export function createEmailProvider(): EmailProvider {
  switch (env.EMAIL_PROVIDER) {
    case 'resend':
      return new ResendEmailProvider()
    case 'smtp':
    default:
      return new SmtpEmailProvider()
  }
}
