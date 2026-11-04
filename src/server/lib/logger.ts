import 'server-only'

// Minimal JSON logger for M0; replaced by pino + PII redact in M0-T08.
// Interface intentionally matches the pino shape so callers need no changes.

type LogLevel = 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace'

const LEVEL_NUMS: Record<LogLevel, number> = {
  fatal: 60,
  error: 50,
  warn: 40,
  info: 30,
  debug: 20,
  trace: 10,
}

function emit(level: LogLevel, msg: string, ctx?: Record<string, unknown>): void {
  process.stdout.write(
    JSON.stringify({ level: LEVEL_NUMS[level], time: Date.now(), msg, ...ctx }) + '\n',
  )
}

export const logger = {
  fatal: (msg: string, ctx?: Record<string, unknown>) => emit('fatal', msg, ctx),
  error: (msg: string, ctx?: Record<string, unknown>) => emit('error', msg, ctx),
  warn: (msg: string, ctx?: Record<string, unknown>) => emit('warn', msg, ctx),
  info: (msg: string, ctx?: Record<string, unknown>) => emit('info', msg, ctx),
  debug: (msg: string, ctx?: Record<string, unknown>) => emit('debug', msg, ctx),
  trace: (msg: string, ctx?: Record<string, unknown>) => emit('trace', msg, ctx),
}
