import 'server-only'
import pino from 'pino'

// Each PII field listed at both top-level and nested (*.field) depth.
// Pino replaces matched values with censor before writing to stdout.
const PII_PATHS = [
  'password',
  '*.password',
  'token',
  '*.token',
  'email',
  '*.email',
  'phone',
  '*.phone',
  'whatsapp',
  '*.whatsapp',
  'wechat',
  '*.wechat',
  'linkedin',
  '*.linkedin',
  'cookie',
  '*.cookie',
  'authorization',
  '*.authorization',
  // Nodemailer / SMTP error fields that may carry recipient addresses or SMTP responses
  'err.envelope',
  'err.rejected',
  'err.accepted',
  'err.response',
  'err.message',
  '*.err.envelope',
  '*.err.rejected',
  '*.err.accepted',
  '*.err.response',
  '*.err.message',
]

/** Strips PII from error objects before logging.
 * Nodemailer errors expose envelope/rejected/response with recipient addresses.
 * Resend errors expose message/name with email addresses.
 * Only name, code, and stack frames (first "Error: …" line stripped) are retained.
 * message is intentionally omitted: nodemailer/Resend messages often include the recipient address.
 * Stack first line (which echoes message) is also stripped for the same reason.
 */
function serializeErr(err: unknown): Record<string, unknown> {
  if (err == null) return {}
  if (typeof err !== 'object') return { type: typeof err }
  const e = err as Record<string, unknown>
  const result: Record<string, unknown> = {}
  if (typeof e.name === 'string') result.name = e.name
  if (typeof e.code === 'string' || typeof e.code === 'number') result.code = e.code
  if (typeof e.stack === 'string') {
    // Skip the first line of the stack trace (which is `ErrorName: message` and may contain PII)
    const frames = e.stack.split('\n').slice(1).join('\n')
    result.stack = frames.slice(0, 500)
  }
  return result
}

export const pinoOptions: pino.LoggerOptions = {
  serializers: { err: serializeErr },
  redact: {
    paths: PII_PATHS,
    censor: '[REDACTED]',
  },
}

export const logger = pino(pinoOptions)
