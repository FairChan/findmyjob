/**
 * Verifies that the logger's err serializer strips email addresses and other PII
 * from error objects so nodemailer/Resend errors never reach log output.
 *
 * DO NOT DELETE — guards the security invariant from CLAUDE.md "日志只记录路由模板、requestId 和内部 ID"
 */
import { describe, it, expect } from 'vitest'
import pino from 'pino'
import { Writable } from 'node:stream'
import { pinoOptions } from '@/server/lib/logger'

const EMAIL_SENTINEL = 'leaked-addr@example.test'
// Synthetic bearer value used only to verify message-line stripping
const TOKEN_SENTINEL = 'bearer_test_value_for_logger_scrub_test'

function captureLog(fn: (log: pino.Logger) => void): string {
  const chunks: Buffer[] = []
  const stream = new Writable({
    write(chunk, _enc, cb) {
      chunks.push(chunk as Buffer)
      cb()
    },
  })
  const log = pino(pinoOptions, stream)
  fn(log)
  return chunks.map((c) => c.toString()).join('')
}

describe('logger err serializer – nodemailer-style error', () => {
  const nodemailerErr = Object.assign(new Error('send failed'), {
    envelope: { from: 'sender@example.com', to: [EMAIL_SENTINEL] },
    rejected: [EMAIL_SENTINEL],
    accepted: ['ok@example.com'],
    response: `550 5.1.1 ${EMAIL_SENTINEL} does not exist`,
    code: 'EENVELOPE',
  })

  it('output does not contain the email address', () => {
    const output = captureLog((log) => log.error({ err: nodemailerErr }, 'email failed'))
    expect(output).not.toContain(EMAIL_SENTINEL)
  })

  it('output retains err.name and err.code', () => {
    const output = captureLog((log) => log.error({ err: nodemailerErr }, 'email failed'))
    expect(output).toContain('Error')
    expect(output).toContain('EENVELOPE')
  })

  it('output does not contain envelope field', () => {
    const output = captureLog((log) => log.error({ err: nodemailerErr }, 'email failed'))
    expect(output).not.toContain('envelope')
  })
})

describe('logger err serializer – Resend-style error', () => {
  const resendErr = Object.assign(new Error(`Failed to deliver to ${EMAIL_SENTINEL}`), {
    name: 'ResendError',
    statusCode: 422,
  })

  it('output does not contain the email address', () => {
    const output = captureLog((log) => log.error({ err: resendErr }, 'resend failed'))
    expect(output).not.toContain(EMAIL_SENTINEL)
  })

  it('output retains err.name', () => {
    const output = captureLog((log) => log.error({ err: resendErr }, 'resend failed'))
    expect(output).toContain('ResendError')
  })
})

describe('logger err serializer – token in error message (message line stripped)', () => {
  const tokenErr = new Error(`Invalid token: ${TOKEN_SENTINEL}`)

  it('output does not contain the token (stripped from message line in stack)', () => {
    const output = captureLog((log) => log.error({ err: tokenErr }, 'token error'))
    expect(output).not.toContain(TOKEN_SENTINEL)
  })
})

describe('logger err serializer – email in err.message field directly', () => {
  it('output does not contain the email from err.message', () => {
    const errWithEmailMsg = new Error(`Delivery failed: ${EMAIL_SENTINEL}`)
    const output = captureLog((log) => log.error({ err: errWithEmailMsg }, 'delivery failed'))
    expect(output).not.toContain(EMAIL_SENTINEL)
  })
})
