import path from 'node:path'
import { defineConfig } from 'vitest/config'

// Opt-in integration profile. Fail before global setup or imported test modules.
// This never creates, migrates, or starts a database and never falls back to DATABASE_URL.
function requireIsolatedUrl(value: string | undefined) {
  if (!value) throw new Error('Explicit isolated semantic-vector test database is required')
  const url = new URL(value)
  if (!['postgres:', 'postgresql:'].includes(url.protocol)
    || !['127.0.0.1', 'localhost'].includes(url.hostname)
    || url.port !== '55439' || url.pathname !== '/findmyjob_m9_vector_test') {
    throw new Error('Semantic-vector tests require the named local synthetic database on port 55439')
  }
}
requireIsolatedUrl(process.env.TEST_DATABASE_URL)
requireIsolatedUrl(process.env.TEST_ADMIN_DATABASE_URL)

export default defineConfig({
  resolve: { alias: {
    '@': path.resolve(__dirname, 'src'),
    'server-only': path.resolve(__dirname, 'tests/setup/server-only-shim.ts'),
  } },
  test: {
    environment: 'node', include: ['tests/semantic-vector/**/*.test.ts'],
    setupFiles: ['tests/setup/assertions.ts'], globalSetup: ['tests/setup/global-test-db-lock.ts'],
    fileParallelism: false, testTimeout: 30_000,
  },
})
