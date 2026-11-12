import { defineConfig, devices } from '@playwright/test'
import { readFileSync } from 'fs'
import { parseEnv } from 'util'
import { validateTestDbUrl } from './tests/lib/validate-test-db-url'
import { SERVER_LOG_PATH } from './tests/e2e/helpers/server-log-path'

// Convention:
//  - Every E2E run spawns its own dev server (reuseExistingServer: false).
//  - Lane B uses port 3001; mainline uses port 3000. The two never share a server.
//  - If port 3001 is already in use (e.g. a manual `pnpm dev` session), Playwright
//    will fail to start. Stop the dev server first.
//  - TEST_DATABASE_URL must end with _test and point to localhost.
//    The dev server is started with DATABASE_URL=TEST_DATABASE_URL so the entire
//    E2E run (browser + server + test workers) uses the same test database.

// Resolve TEST_DATABASE_URL: use process.env if already set (CI), else read .env.
let testDatabaseUrl: string
if (process.env.TEST_DATABASE_URL) {
  testDatabaseUrl = process.env.TEST_DATABASE_URL
} else {
  // Parse .env and extract only TEST_DATABASE_URL — do not dump the whole file into
  // process.env. The value is never printed.
  try {
    const envContent = readFileSync('.env', 'utf8')
    const parsed = parseEnv(envContent)
    if (!parsed.TEST_DATABASE_URL) {
      throw new Error('TEST_DATABASE_URL not found in .env')
    }
    testDatabaseUrl = parsed.TEST_DATABASE_URL
    // Make it visible to Playwright worker processes (they fork after this runs).
    process.env.TEST_DATABASE_URL = testDatabaseUrl
  } catch (err) {
    throw new Error(
      `[playwright.config] Cannot resolve TEST_DATABASE_URL: ${(err as Error).message}\n` +
        '  Add TEST_DATABASE_URL=postgresql://...@127.0.0.1:5432/<findmyjob_test|findmyjob_laneb_test> to .env',
    )
  }
}

// Validate before we start anything — a bad URL means we stop right here.
validateTestDbUrl(testDatabaseUrl)

// 主线默认 3000；线 B 的 lane-auto.sh 设 PORT=3001。两条线各自起 dev server，互不复用
const port = Number(process.env.PORT) || 3000

export default defineConfig({
  // M4-T14/T15：准备人才库的企业、学生、收藏夹（只写测试库，密码每次随机）
  globalSetup: './tests/e2e/global-setup.ts',
  // Runs only against a production build (playwright.prod.config.ts, `pnpm test:e2e:prod`).
  testIgnore: ['**/security-headers.spec.ts', '**/csp-registration-upload.spec.ts'],
  // M4-T26：在全部 spec 结束后检查服务端日志没有 PII 哨兵
  globalTeardown: './tests/e2e/global-teardown.ts',
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'html',
  use: {
    baseURL: `http://localhost:${port}`,
    trace: 'on-first-retry',
  },
  projects: [
    // 先登录一次、写出 storageState（auth.setup.ts），其余用例依赖它
    {
      name: 'setup',
      testMatch: /auth\.setup\.ts/,
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
      dependencies: ['setup'],
    },
  ],
  webServer: {
    // Wrapper tees dev server output to SERVER_LOG_PATH for the PII log check in globalTeardown.
    command: `node tests/e2e/start-dev-server.mjs`,
    url: `http://localhost:${port}`,
    // Always start a fresh server so it uses the test database — never reuse an
    // existing server that might be connected to the development database.
    reuseExistingServer: false,
    stdout: 'pipe',
    stderr: 'pipe',
    env: {
      DATABASE_URL: testDatabaseUrl,
      PORT: String(port),
      SERVER_LOG_PATH,
    },
  },
})
