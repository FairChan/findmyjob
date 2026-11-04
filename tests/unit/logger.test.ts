import { describe, it, expect } from 'vitest'
import pino from 'pino'
import { pinoOptions } from '@/server/lib/logger'

// Use a synchronous write target so log entries are captured before assertions.
function captureLogger() {
  const lines: string[] = []
  const dest: pino.DestinationStream = {
    write(msg: string) {
      lines.push(msg.trim())
    },
  }
  const log = pino({ ...pinoOptions, level: 'trace' }, dest)
  return { log, lines }
}

describe('logger PII redaction', () => {
  it('redacts top-level email', () => {
    const { log, lines } = captureLogger()
    log.info({ email: 'leak-sentinel@example.test' }, 'sentinel')
    expect(lines[0]).not.toContain('leak-sentinel@example.test')
    expect(lines[0]).toContain('[REDACTED]')
  })

  it('redacts top-level phone', () => {
    const { log, lines } = captureLogger()
    log.info({ phone: '+60 12-000 0420' }, 'sentinel')
    expect(lines[0]).not.toContain('+60 12-000 0420')
    expect(lines[0]).toContain('[REDACTED]')
  })

  it('redacts nested token (*.token)', () => {
    const { log, lines } = captureLogger()
    log.info({ session: { token: 'secret-token-xyz-999' } }, 'sentinel')
    expect(lines[0]).not.toContain('secret-token-xyz-999')
    expect(lines[0]).toContain('[REDACTED]')
  })

  it('redacts all three sentinel values in one entry', () => {
    const { log, lines } = captureLogger()
    log.info(
      {
        email: 'leak-sentinel@example.test',
        phone: '+60 12-000 0420',
        session: { token: 'secret-token-xyz-999' },
      },
      'sentinel',
    )
    const output = lines[0]
    expect(output).not.toContain('leak-sentinel@example.test')
    expect(output).not.toContain('+60 12-000 0420')
    expect(output).not.toContain('secret-token-xyz-999')
  })

  it('redacts nested email (*.email)', () => {
    const { log, lines } = captureLogger()
    log.info({ user: { email: 'nested@example.test' } }, 'nested email')
    expect(lines[0]).not.toContain('nested@example.test')
  })

  it('redacts top-level authorization', () => {
    const { log, lines } = captureLogger()
    log.info({ authorization: 'Bearer mysecrettoken' }, 'auth header')
    expect(lines[0]).not.toContain('mysecrettoken')
  })

  it('logger.error emits level 50', () => {
    const { log, lines } = captureLogger()
    log.error('test error')
    const entry = JSON.parse(lines[0]) as { level: number }
    expect(entry.level).toBe(50)
  })

  it('non-PII fields are not redacted', () => {
    const { log, lines } = captureLogger()
    log.info({ gpa: '3.8', year: 2025, companyId: 'c-abc123' }, 'no redact')
    const output = lines[0]
    expect(output).toContain('3.8')
    expect(output).toContain('2025')
    expect(output).toContain('c-abc123')
  })
})
