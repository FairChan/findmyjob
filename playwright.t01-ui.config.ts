import { defineConfig } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import base from './playwright.config'

// Dedicated synthetic server. No parse requests or worker are started by this suite.
const blockedLog = process.env.T01_AI_BLOCK_LOG ?? join(tmpdir(), 'findmyjob-t01-no-ai-' + randomUUID() + '.log')
const guard = resolve('tests/e2e/helpers/resume-parse-no-ai.cjs').replaceAll('\\', '/')
process.env.ANTHROPIC_API_KEY = 'SYNTHETIC_T01_NO_EXTERNAL_AI'
process.env.AI_MODEL_PARSE = 'synthetic-t01-no-external-ai'
process.env.T01_AI_BLOCK_LOG = blockedLog
const server = base.webServer
if (!server || Array.isArray(server)) throw new Error('Expected one owned Playwright server')
export default defineConfig({ ...base,
  fullyParallel: false, workers: 1, retries: 0,
  testMatch: ['**/auth.setup.ts', '**/smoke-m9-t01-ui.spec.ts'],
  projects: base.projects!.map(project => ({ ...project,
    testMatch: project.name === 'setup' ? '**/auth.setup.ts' : '**/smoke-m9-t01-ui.spec.ts',
  })),
  use: { ...base.use, trace: 'off', video: 'off', screenshot: 'off', actionTimeout: 15_000 },
  webServer: { ...server, reuseExistingServer: false, env: {
    ...server.env, APP_ENV: 'ci', SKIP_ENV_VALIDATION: '',
    ANTHROPIC_API_KEY: 'SYNTHETIC_T01_NO_EXTERNAL_AI', AI_MODEL_PARSE: 'synthetic-t01-no-external-ai',
    T01_AI_BLOCK_LOG: blockedLog, NODE_OPTIONS: '--require "' + guard + '"',
  } },
})
