import { defineConfig, devices } from '@playwright/test'
import { randomBytes, randomUUID } from 'node:crypto'
import { mkdtempSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import base from './playwright.config'

// This dedicated config creates an ephemeral signing key, never using a real mail key.
const runId = process.env.T04_OFFLINE_RUN_ID ?? randomUUID()
const directory = process.env.T04_OFFLINE_DIR ?? mkdtempSync(join(tmpdir(), 'findmyjob-t04-'))
const secret = process.env.T04_SYNTHETIC_SECRET ?? randomBytes(48).toString('base64url')
const guard = resolve('tests/e2e/helpers/marketing-t04-offline.cjs').replaceAll('\\', '/')
const synthetic = {
  T04_OFFLINE_RUN_ID: runId, T04_OFFLINE_DIR: directory, T04_SYNTHETIC_SECRET: secret,
  MARKETING_UNSUBSCRIBE_SECRET: secret, APP_ENV: 'ci', SKIP_ENV_VALIDATION: '',
  EMAIL_PROVIDER: 'smtp', SMTP_URL: 'smtp://127.0.0.1:1025', ANTHROPIC_API_KEY: 'synthetic',
  TURNSTILE_SECRET_KEY: '1x0000000000000000000000000000000AA',
  NEXT_TELEMETRY_DISABLED: '1', SENTRY_DSN: '', NEXT_PUBLIC_SENTRY_DSN: '',
  NODE_OPTIONS: '--require "' + guard + '"',
}
Object.assign(process.env, synthetic)
// Protect this runner as well as its future workers and owned dev server.
createRequire(resolve('playwright.t04-ui.config.ts'))(guard)
const server = base.webServer
if (!server || Array.isArray(server)) throw new Error('Expected one owned Playwright server')

export default defineConfig({ ...base,
  // loginAs supplies only the actors needed here; the broad suite setup is unrelated.
  globalSetup: undefined,
  fullyParallel: false, workers: 1, retries: 0, reporter: 'line',
  testMatch: '**/smoke-m9-t04-marketing.spec.ts',
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  use: { ...base.use, serviceWorkers: 'block', trace: 'off', video: 'off', screenshot: 'off', actionTimeout: 15_000 },
  webServer: { ...server, command: 'node tests/e2e/helpers/marketing-t04-server.cjs',
    reuseExistingServer: false, env: { ...server.env, ...synthetic } },
})
