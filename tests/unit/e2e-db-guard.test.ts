/**
 * Unit tests for the E2E database safety guards:
 *   - validateTestDbUrl rejects non-test or non-local URLs
 *   - createE2eDb throws in production/staging environments
 */
import { describe, it, expect } from 'vitest'
import { validateTestDbUrl } from '../lib/validate-test-db-url'

// ---------------------------------------------------------------------------
// validateTestDbUrl
// ---------------------------------------------------------------------------

describe('validateTestDbUrl', () => {
  describe('rejected URLs', () => {
    it('rejects the lane-b development database', () => {
      expect(() =>
        validateTestDbUrl('postgresql://u:p@127.0.0.1:5432/findmyjob_laneb'),
      ).toThrow(/DB name must end with _test/i)
    })

    it('rejects the mainline development database', () => {
      expect(() =>
        validateTestDbUrl('postgresql://u:p@127.0.0.1:5432/findmyjob'),
      ).toThrow(/DB name must end with _test/i)
    })

    it('rejects a non-localhost host', () => {
      expect(() =>
        validateTestDbUrl('postgresql://u:p@db.example.com:5432/findmyjob_test'),
      ).toThrow(/host must be localhost/i)
    })

    it('rejects undefined', () => {
      expect(() => validateTestDbUrl(undefined)).toThrow(/TEST_DATABASE_URL is not set/)
    })

    it('rejects an empty string', () => {
      expect(() => validateTestDbUrl('')).toThrow(/TEST_DATABASE_URL is not set/)
    })

    it('rejects a name that contains _test but does not end with it', () => {
      expect(() =>
        validateTestDbUrl('postgresql://u:p@127.0.0.1:5432/findmyjob_test_x'),
      ).toThrow(/DB name must end with _test/i)
    })
  })

  describe('accepted URLs', () => {
    it('accepts a valid lane-b test URL with query params', () => {
      const url = 'postgresql://u:p@127.0.0.1:5432/findmyjob_laneb_test?connection_limit=5'
      expect(validateTestDbUrl(url)).toBe(url)
    })

    it('accepts localhost hostname', () => {
      const url = 'postgresql://u:p@localhost:5432/findmyjob_laneb_test'
      expect(validateTestDbUrl(url)).toBe(url)
    })

    it('accepts ::1 (IPv6 loopback)', () => {
      const url = 'postgresql://u:p@[::1]:5432/findmyjob_laneb_test'
      expect(validateTestDbUrl(url)).toBe(url)
    })
  })

  it('error message does not include the password', () => {
    let msg = ''
    try {
      validateTestDbUrl('postgresql://user:SuperSecret99!@db.prod.example.com:5432/findmyjob')
    } catch (e) {
      msg = (e as Error).message
    }
    expect(msg).not.toContain('SuperSecret99!')
  })
})

// ---------------------------------------------------------------------------
// createE2eDb — production/staging guard
// ---------------------------------------------------------------------------

describe('createE2eDb', () => {
  it('throws when APP_ENV is production', async () => {
    // Dynamically import to inject a fake env without side-effects on module load.
    const { createE2eDb } = await import('../e2e/helpers/db')
    expect(() =>
      createE2eDb({
        TEST_DATABASE_URL: 'postgresql://u:p@127.0.0.1:5432/findmyjob_laneb_test',
        APP_ENV: 'production',
      }),
    ).toThrow(/APP_ENV=production/)
  })

  it('throws when APP_ENV is staging', async () => {
    const { createE2eDb } = await import('../e2e/helpers/db')
    expect(() =>
      createE2eDb({
        TEST_DATABASE_URL: 'postgresql://u:p@127.0.0.1:5432/findmyjob_laneb_test',
        APP_ENV: 'staging',
      }),
    ).toThrow(/APP_ENV=staging/)
  })

  it('throws when TEST_DATABASE_URL is missing even in a safe environment', async () => {
    const { createE2eDb } = await import('../e2e/helpers/db')
    expect(() => createE2eDb({ TEST_DATABASE_URL: undefined, APP_ENV: 'ci' })).toThrow(
      /TEST_DATABASE_URL is not set/,
    )
  })
})
