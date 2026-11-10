// Run through scripts/load/run-mutations.mjs: real Server Actions via existing UI.
import { runUnlock } from './lib/mutation-browser.js'

const scenario = __ENV.LOAD_SCENARIO
if (!['balanceRace', 'idempotentUnlock'].includes(scenario)) throw new Error('Explicit unlock scenario required')
export const options = {
  scenarios: { unlock: { executor: 'per-vu-iterations', vus: 10, iterations: 1, maxDuration: '2m', gracefulStop: '10s', options: { browser: { type: 'chromium' } } } },
  thresholds: { mutation_completed: ['count==10'], mutation_failures: ['count==0'] },
}
export default async function unlock() { await runUnlock(scenario, __VU - 1) }
