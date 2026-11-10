// Fresh applicant per measured iteration; duplicate behavior is a separate two-client control.
import execution from 'k6/execution'
import { runApply } from './lib/mutation-browser.js'

const duplicate = __ENV.LOAD_SCENARIO === 'duplicateApply'
const full = __ENV.LOAD_PROFILE === 'full' && !duplicate
export const options = {
  scenarios: { apply: {
    ...(full ? { executor: 'constant-vus', vus: 20, duration: '2m' }
      : { executor: 'per-vu-iterations', vus: duplicate ? 2 : 20, iterations: 1, maxDuration: '2m' }),
    gracefulStop: '2m', options: { browser: { type: 'chromium' } },
  } },
  thresholds: {
    mutation_completed: [duplicate ? 'count==2' : full ? 'count>=20' : 'count==20'],
    mutation_failures: ['count==0'],
  },
}
export default async function jobApply() {
  await runApply(duplicate ? 'duplicateApply' : 'apply', duplicate ? __VU - 1 : execution.scenario.iterationInTest)
}
