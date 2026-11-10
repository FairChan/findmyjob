import { defineConfig } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import base from './playwright.config'

// Explicit mode, never skip ranking tests when the optional store is missing.
const vector = process.env.T03_VECTOR_LANE === '1'
const url = new URL(process.env.TEST_DATABASE_URL!)
if (vector && (!['localhost', '127.0.0.1'].includes(url.hostname) || url.port !== '55439' || url.pathname !== '/findmyjob_m9_vector_test')) {
  throw new Error('Vector UI lane requires the separately prepared localhost:55439/findmyjob_m9_vector_test environment')
}
const log = process.env.T03_AI_LOG ?? join(tmpdir(), 'findmyjob-t03-synthetic-' + randomUUID() + '.log')
process.env.T03_AI_LOG = log
process.env.VOYAGE_API_KEY = 'SYNTHETIC_T03_NO_EXTERNAL_AI'
process.env.AI_MODEL_EMBED = 'synthetic-t03-embedding'
process.env.T03_VECTOR_LANE = vector ? '1' : '0'
const server = base.webServer
if (!server || Array.isArray(server)) throw new Error('One owned Playwright server required')
const spec = vector ? '**/smoke-m9-t03-ui.spec.ts' : '**/smoke-m9-t03-fallback.spec.ts'
export default defineConfig({ ...base,
  fullyParallel: false, workers: 1, retries: 0, testMatch: ['**/auth.setup.ts', spec],
  projects: base.projects!.map(project => ({ ...project, testMatch: project.name === 'setup' ? '**/auth.setup.ts' : spec })),
  use: { ...base.use, baseURL: 'http://localhost:3009', trace: 'off', video: 'off', screenshot: 'off', actionTimeout: 15_000 },
  webServer: { ...server, url: 'http://localhost:3009', reuseExistingServer: false, env: {
    ...server.env, PORT: '3009', APP_ENV: 'ci', SKIP_ENV_VALIDATION: '',
    APP_URL: 'http://localhost:3009', BETTER_AUTH_URL: 'http://localhost:3009', INTERNAL_BASE_URL: 'http://127.0.0.1:3009',
    VOYAGE_API_KEY: 'SYNTHETIC_T03_NO_EXTERNAL_AI', AI_MODEL_EMBED: 'synthetic-t03-embedding',
    T03_AI_LOG: log, T03_VECTOR_LANE: vector ? '1' : '0',
    NODE_OPTIONS: '--require "' + resolve('tests/e2e/helpers/matching-t03-transport.cjs').replaceAll('\\', '/') + '"',
  } },
})
