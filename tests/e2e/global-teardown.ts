/**
 * E2E global teardown: reads the dev server log written by start-dev-server.mjs
 * and asserts that no PII sentinel values from pii-leak.spec.ts leaked into server logs.
 * Also asserts at least one pino JSON line was collected (prevents empty-log false pass).
 */
import { readFileSync, existsSync } from 'fs'
import { SERVER_LOG_PATH, PII_SENTINELS } from './helpers/server-log-path'

// True when the CLI narrowed the run (spec paths, --grep, --last-failed, --only-changed). Such a
// run may never hit a code path that logs, so the "≥1 pino line" guard is only meaningful for the
// full suite (pnpm test:e2e / lane-verify). The sentinel check below runs either way.
function isFilteredRun(argv: string[]): boolean {
  const i = argv.indexOf('test')
  if (i < 0) return false
  const args = argv.slice(i + 1)
  const valueFlags = new Set(['-c', '--config', '--project', '--reporter', '--workers', '-j', '--retries', '--timeout', '--output', '--max-failures', '--repeat-each', '--shard', '--trace'])
  for (let k = 0; k < args.length; k++) {
    const a = args[k]
    if (['-g', '--grep', '--grep-invert', '--last-failed', '--only-changed'].some(f => a === f || a.startsWith(`${f}=`))) return true
    if (valueFlags.has(a)) { k++; continue }
    if (!a.startsWith('-')) return true
  }
  return false
}

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
  if (pinoLines.length === 0 && !isFilteredRun(process.argv)) {
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
