/**
 * E2E global teardown: reads the dev server log written by start-dev-server.mjs
 * and asserts that no PII sentinel values from pii-leak.spec.ts leaked into server logs.
 * Also asserts at least one pino JSON line was collected (prevents empty-log false pass).
 */
import { readFileSync, existsSync } from 'fs'
import { SERVER_LOG_PATH, PII_SENTINELS } from './helpers/server-log-path'

export default async function globalTeardown(): Promise<void> {
  if (!existsSync(SERVER_LOG_PATH)) {
    throw new Error(
      `[global-teardown] Server log not found: ${SERVER_LOG_PATH}. ` +
        'The dev server wrapper (start-dev-server.mjs) may not have written output.',
    )
  }

  const log = readFileSync(SERVER_LOG_PATH, 'utf8')

  // Guard against silent collection failure: at least 1 pino JSON line must exist.
  const pinoLines = log.split('\n').filter((line) => {
    if (!line.trim().startsWith('{')) return false
    try {
      const parsed = JSON.parse(line) as unknown
      return (
        typeof parsed === 'object' &&
        parsed !== null &&
        'level' in (parsed as object) &&
        'time' in (parsed as object)
      )
    } catch {
      return false
    }
  })
  // src/instrumentation.ts logs one `server started` line per boot, so this holds for any run.
  if (pinoLines.length === 0) {
    throw new Error(
      `[global-teardown] Server log has no pino JSON lines — log collection may have failed. ` +
        `Log path: ${SERVER_LOG_PATH}. First 500 chars: ${log.slice(0, 500)}`,
    )
  }

  // No PII sentinel value must appear anywhere in the server log.
  for (const sentinel of PII_SENTINELS) {
    if (log.includes(sentinel)) {
      throw new Error(
        `[global-teardown] PII leaked to server log: found "${sentinel}" in ${SERVER_LOG_PATH}`,
      )
    }
  }
}
