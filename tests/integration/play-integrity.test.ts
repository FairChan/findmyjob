/**
 * MA1-T03: Play Integrity verdict checks and single-use enforcement. Google's OAuth and
 * decodeIntegrityToken endpoints are mocked; the replay guard uses the real test database.
 */
import { vi, describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest'
import { generateKeyPairSync, createVerify } from 'crypto'
import { writeFileSync, mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

vi.mock('@/server/db', async () => {
  const { testDb } = await import('../setup/db')
  return { db: testDb }
})
vi.mock('@/server/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}))

import { setupTestDb, testDb } from '../setup/db'
import {
  isPlayIntegrityConfigured,
  playIntegrityRequestHash,
  PlayIntegrityError,
  resetPlayIntegrityTokenCache,
  verifyPlayIntegrity,
} from '@/server/lib/play-integrity'

setupTestDb()

const PKG = 'asia.findmyjob.app.staging'
const CERT = 'q2FiY2RlZmdoaWprbG1ub3BxcnN0dXZ3eHl6MDEyMzQ1Njc4OQ'
const EMAIL = 'Probe@Example.test'
let saFile = ''
let publicKey = ''

beforeAll(() => {
  const keys = generateKeyPairSync('rsa', { modulusLength: 2048 })
  publicKey = keys.publicKey.export({ type: 'spki', format: 'pem' }).toString()
  const dir = mkdtempSync(join(tmpdir(), 'fmj-pi-'))
  saFile = join(dir, 'sa.json')
  writeFileSync(
    saFile,
    JSON.stringify({
      client_email: 'integrity@example.iam.gserviceaccount.com',
      private_key: keys.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
      token_uri: 'https://oauth2.example.test/token',
    }),
  )
})

function goodPayload(overrides: Record<string, unknown> = {}) {
  return {
    requestDetails: {
      requestPackageName: PKG,
      requestHash: playIntegrityRequestHash('login', EMAIL),
      timestampMillis: String(Date.now()),
    },
    appIntegrity: { appRecognitionVerdict: 'PLAY_RECOGNIZED', packageName: PKG, certificateSha256Digest: [CERT] },
    deviceIntegrity: { deviceRecognitionVerdict: ['MEETS_DEVICE_INTEGRITY'] },
    ...overrides,
  }
}

let payload: Record<string, unknown> = goodPayload()
const fetchMock = vi.fn(async (url: string | URL, init?: RequestInit) => {
  const u = String(url)
  if (u === 'https://oauth2.example.test/token') {
    const assertion = new URLSearchParams(String(init?.body)).get('assertion') ?? ''
    const [h, c, sig] = assertion.split('.')
    const valid = createVerify('RSA-SHA256').update(`${h}.${c}`).verify(publicKey, Buffer.from(sig ?? '', 'base64url'))
    const claims = JSON.parse(Buffer.from(c ?? '', 'base64url').toString())
    if (!valid || claims.scope !== 'https://www.googleapis.com/auth/playintegrity') return new Response('{}', { status: 401 })
    return Response.json({ access_token: 'at-1', expires_in: 3600 })
  }
  if (u === `https://playintegrity.googleapis.com/v1/${PKG}:decodeIntegrityToken`) {
    if ((init?.headers as Record<string, string>).Authorization !== 'Bearer at-1') return new Response('{}', { status: 403 })
    return Response.json({ tokenPayloadExternal: payload })
  }
  return new Response('not mocked', { status: 599 })
})

beforeEach(() => {
  vi.stubEnv('PLAY_INTEGRITY_PACKAGE_NAME', PKG)
  vi.stubEnv('GOOGLE_SERVICE_ACCOUNT_FILE', saFile)
  vi.stubEnv('ANDROID_CERT_SHA256', `other-cert,${CERT}`)
  vi.stubGlobal('fetch', fetchMock)
  resetPlayIntegrityTokenCache()
  fetchMock.mockClear()
  payload = goodPayload()
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

let n = 0
const token = () => `integrity-token-${Date.now()}-${n++}`

describe('Play Integrity', () => {
  it('is disabled unless package, service account and certificate are all configured', () => {
    expect(isPlayIntegrityConfigured()).toBe(true)
    vi.stubEnv('ANDROID_CERT_SHA256', '')
    expect(isPlayIntegrityConfigured()).toBe(false)
  })

  it('binds the request hash to action and normalised email', () => {
    expect(playIntegrityRequestHash('login', ' probe@example.TEST ')).toBe(playIntegrityRequestHash('login', EMAIL))
    expect(playIntegrityRequestHash('register', EMAIL)).not.toBe(playIntegrityRequestHash('login', EMAIL))
  })

  it('accepts a genuine verdict once and rejects its replay', async () => {
    const t = token()
    await expect(verifyPlayIntegrity(t, { action: 'login', email: EMAIL })).resolves.toBeUndefined()
    await expect(verifyPlayIntegrity(t, { action: 'login', email: EMAIL })).rejects.toThrow(/replayed/)
    expect(await testDb.rateLimitBucket.count({ where: { key: { startsWith: 'play-integrity:' } } })).toBe(1)
  })

  it.each([
    ['another package', { requestDetails: { ...goodPayload().requestDetails, requestPackageName: 'com.evil.app' } }, 'request package'],
    ['hash for another action', { requestDetails: { ...goodPayload().requestDetails, requestHash: playIntegrityRequestHash('register', EMAIL) } }, 'request hash'],
    ['hash for another email', { requestDetails: { ...goodPayload().requestDetails, requestHash: playIntegrityRequestHash('login', 'x@example.test') } }, 'request hash'],
    ['stale token', { requestDetails: { ...goodPayload().requestDetails, timestampMillis: String(Date.now() - 6 * 60_000) } }, 'stale'],
    ['sideloaded / unrecognised build', { appIntegrity: { ...goodPayload().appIntegrity, appRecognitionVerdict: 'UNRECOGNIZED_VERSION' } }, 'app not recognized'],
    ['re-signed build', { appIntegrity: { ...goodPayload().appIntegrity, certificateSha256Digest: ['evil-cert'] } }, 'certificate'],
    ['emulator / rooted device', { deviceIntegrity: { deviceRecognitionVerdict: [] } }, 'device'],
  ])('rejects %s', async (_label, override, reason) => {
    payload = goodPayload(override)
    const err = await verifyPlayIntegrity(token(), { action: 'login', email: EMAIL }).catch((e) => e)
    expect(err).toBeInstanceOf(PlayIntegrityError)
    expect((err as PlayIntegrityError).reason).toBe(reason)
  })

  it('fails closed when Google is unreachable or not configured', async () => {
    fetchMock.mockImplementationOnce(async () => {
      throw new TypeError('fetch failed')
    })
    await expect(verifyPlayIntegrity(token(), { action: 'login', email: EMAIL })).rejects.toBeInstanceOf(PlayIntegrityError)
    vi.stubEnv('PLAY_INTEGRITY_PACKAGE_NAME', '')
    await expect(verifyPlayIntegrity(token(), { action: 'login', email: EMAIL })).rejects.toThrow(/not configured/)
  })

  it('reuses the OAuth access token across verifications', async () => {
    await verifyPlayIntegrity(token(), { action: 'login', email: EMAIL })
    await verifyPlayIntegrity(token(), { action: 'login', email: EMAIL })
    expect(fetchMock.mock.calls.filter(([u]) => String(u).includes('oauth2')).length).toBe(1)
  })
})
