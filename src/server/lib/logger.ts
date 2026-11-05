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
]

export const pinoOptions: pino.LoggerOptions = {
  redact: {
    paths: PII_PATHS,
    censor: '[REDACTED]',
  },
}

export const logger = pino(pinoOptions)
