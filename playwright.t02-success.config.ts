import { defineConfig } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import base from './playwright.config'

// Only this dedicated test server loads the HTTP fixture. Application code has no test switch.
const fixtureDir = process.env.T02_AI_FIXTURE_DIR ?? mkdtempSync(join(tmpdir(), 'findmyjob-t02-ai-'))
const runId = process.env.T02_AI_RUN_ID ?? randomUUID()
const guard = resolve('tests/e2e/helpers/jd-assistant-synthetic-http.cjs').replaceAll('\\', '/')
const synthetic = {
  ANTHROPIC_API_KEY: 'SYNTHETIC_T02_NO_EXTERNAL_AI',
  AI_MODEL_JD: 'synthetic-t02-jd-model',
  AI_MODEL_PARSE: 'synthetic-t02-resume-prohibited',
  NEXT_TELEMETRY_DISABLED: '1',
  SENTRY_DSN: '',
  NEXT_PUBLIC_SENTRY_DSN: '',
  T02_AI_FIXTURE_DIR: fixtureDir,
  T02_AI_RUN_ID: runId,
}
Object.assign(process.env, synthetic)
const server = base.webServer
if (!server || Array.isArray(server)) throw new Error('Expected one owned Playwright server')

export default defineConfig({ ...base,
  fullyParallel: false, workers: 1, retries: 0,
  testMatch: ['**/auth.setup.ts', '**/smoke-m9-t02.spec.ts', '**/smoke-m9-t02-success.spec.ts'],
  projects: base.projects!.map(project => ({ ...project,
    testMatch: project.name === 'setup' ? '**/auth.setup.ts' : ['**/smoke-m9-t02.spec.ts', '**/smoke-m9-t02-success.spec.ts'],
  })),
  use: { ...base.use, trace: 'off', video: 'off', screenshot: 'off', actionTimeout: 15_000 },
  webServer: { ...server, reuseExistingServer: false, env: {
    ...server.env, ...synthetic,
    APP_ENV: 'ci', SKIP_ENV_VALIDATION: '', EMAIL_PROVIDER: 'smtp',
    SMTP_URL: 'smtp://synthetic-no-mail.example.test:2525',
    // The existing non-production verification path handles this public test secret without HTTP.
    TURNSTILE_SECRET_KEY: '1x0000000000000000000000000000000AA',
    NODE_OPTIONS: '--require "' + guard + '"',
  } },
})
