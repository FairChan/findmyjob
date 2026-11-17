import { ApiError, apiFetch, isCountingEndpoint } from '@/lib/api-client'
import { onAppEvent } from '@/lib/app-events'
import { errorMessageKey } from '@/i18n/error-message'
import { MESSAGES } from '@/i18n/messages'
import { z } from 'zod'

jest.mock('expo-constants', () => ({
  __esModule: true,
  default: { expoConfig: { version: '0.1.0', scheme: 'findmyjob-dev', extra: { apiBaseUrl: 'http://api.test' } } },
}))

const mockGetSession = jest.fn()
jest.mock('@/lib/auth-client', () => ({
  appOrigin: () => 'findmyjob-dev://',
  sessionCookie: async () => 'better-auth.session_token=abc',
  authClient: { getSession: (...a: unknown[]) => mockGetSession(...a) },
}))

const fetchMock = jest.fn()
beforeEach(() => {
  fetchMock.mockReset()
  mockGetSession.mockReset()
  global.fetch = fetchMock as unknown as typeof fetch
})

function respond(status: number, body: unknown) {
  fetchMock.mockResolvedValueOnce({ ok: status >= 200 && status < 300, status, json: async () => body })
}

describe('apiFetch', () => {
  it('sends app origin, version and the stored cookie, never browser credentials', async () => {
    respond(200, { ok: true, data: { id: 'u1' } })
    await expect(apiFetch('/me', { schema: z.object({ id: z.string() }) })).resolves.toEqual({ id: 'u1' })
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('http://api.test/api/m/v1/me')
    expect(init.credentials).toBe('omit')
    expect(init.headers).toMatchObject({ 'expo-origin': 'findmyjob-dev://', 'x-app-version': '0.1.0', cookie: 'better-auth.session_token=abc' })
  })

  it('throws ApiError with the server code', async () => {
    respond(409, { ok: false, code: 'DUPLICATE_APPLICATION' })
    await expect(apiFetch('/applications', { method: 'POST', body: {} })).rejects.toMatchObject({ code: 'DUPLICATE_APPLICATION', status: 409 })
  })

  it('maps network failures to NETWORK_ERROR', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('Network request failed'))
    await expect(apiFetch('/me')).rejects.toMatchObject({ code: 'NETWORK_ERROR' })
  })

  it('refuses a quota-counting endpoint unless the user initiated it', async () => {
    expect(isCountingEndpoint('/jobs/abc/open')).toBe(true)
    expect(isCountingEndpoint('/jobs/abc/preview')).toBe(false)
    await expect(apiFetch('/jobs/abc/open', { method: 'POST' })).rejects.toMatchObject({ code: 'COUNTING_ENDPOINT_NOT_USER_INITIATED' })
    expect(fetchMock).not.toHaveBeenCalled()
    respond(200, { ok: true, data: {} })
    await apiFetch('/jobs/abc/open', { method: 'POST', userInitiated: true })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it.each([
    [426, 'APP_UPDATE_REQUIRED', 'update-required'],
    [409, 'NEEDS_RECONSENT', 'needs-reconsent'],
  ])('%d %s broadcasts %s', async (status, code, event) => {
    const seen: string[] = []
    const off = onAppEvent((e) => seen.push(e))
    respond(status, { ok: false, code })
    await expect(apiFetch('/me')).rejects.toBeInstanceOf(ApiError)
    off()
    expect(seen).toEqual([event])
  })

  it('signs out on 401/403 only when the session is really gone', async () => {
    const seen: string[] = []
    const off = onAppEvent((e) => seen.push(e))
    mockGetSession.mockResolvedValueOnce({ data: { user: { id: 'u1' } } })
    respond(403, { ok: false, code: 'FORBIDDEN' })
    await expect(apiFetch('/me')).rejects.toBeInstanceOf(ApiError)
    expect(seen).toEqual([])
    mockGetSession.mockResolvedValueOnce({ data: null })
    respond(401, { ok: false, code: 'FORBIDDEN' })
    await expect(apiFetch('/me')).rejects.toBeInstanceOf(ApiError)
    off()
    expect(seen).toEqual(['signed-out'])
  })
})

describe('error messages', () => {
  it('maps known codes and falls back to generic', () => {
    expect(errorMessageKey(new ApiError('DUPLICATE_APPLICATION', 409))).toBe('DUPLICATE_APPLICATION')
    expect(errorMessageKey(new ApiError('SOMETHING_NEW', 400))).toBe('generic')
    expect(errorMessageKey(new Error('boom'))).toBe('generic')
  })

  it('has every mobile string in both languages', () => {
    const keys = (o: object, p = ''): string[] =>
      Object.entries(o).flatMap(([k, v]) => (v && typeof v === 'object' ? keys(v, `${p}${k}.`) : [`${p}${k}`]))
    expect(keys(MESSAGES.en.mobile).sort()).toEqual(keys(MESSAGES.zh.mobile).sort())
  })
})
