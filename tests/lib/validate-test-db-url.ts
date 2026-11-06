/**
 * Pure validator for test-database URLs.
 * Shared by tests/setup/db.ts (integration) and tests/e2e/helpers/db.ts (E2E).
 * Keeping it here avoids pulling the full integration-test module (which requires
 * TEST_ADMIN_DATABASE_URL) into the Playwright worker processes.
 */

/**
 * Asserts that `url` points to a local *_test database.
 * Returns the validated URL; never includes credentials in the error message.
 */
export function validateTestDbUrl(url: string | undefined): string {
  if (!url) {
    throw new Error(
      '[validate-test-db-url] TEST_DATABASE_URL is not set.\n' +
        '  Set TEST_DATABASE_URL=postgresql://...@127.0.0.1:5432/findmyjob_laneb_test',
    )
  }
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    throw new Error(
      '[validate-test-db-url] Cannot parse database URL (credentials redacted for safety)',
    )
  }
  // Extract DB name from path (strip leading slash; ignore query params)
  const dbName = decodeURIComponent(parsed.pathname.replace(/^\//, ''))
  const host = parsed.hostname
  // Node.js WHATWG URL returns '[::1]' (with brackets) for IPv6 literals.
  const isLocal =
    host === 'localhost' ||
    host === '127.0.0.1' ||
    host === '::1' ||
    host === '[::1]' ||
    host === '0.0.0.0'

  if (!dbName.endsWith('_test') || !isLocal) {
    throw new Error(
      `[validate-test-db-url] Safety check failed.\n` +
        `  DB name must end with _test and host must be localhost.\n` +
        `  Got: host=${host}, db=${dbName}`,
    )
  }
  return url
}
