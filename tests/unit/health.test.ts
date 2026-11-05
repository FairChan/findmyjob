import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'

vi.mock('@/server/lib/logger', () => ({
  pinoOptions: {},
  logger: {
    fatal: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
  },
}))

const mockTransaction = vi.fn()

vi.mock('@/server/db', () => ({
  db: {
    $transaction: mockTransaction,
  },
}))

const { GET } = await import('@/app/api/health/route')

describe('GET /api/health', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('returns 200 with {status: ok, version} when DB is healthy', async () => {
    mockTransaction.mockResolvedValueOnce(undefined)
    const req = new Request('http://localhost/api/health')
    const res = await GET(req)

    expect(res.status).toBe(200)
    const body = await res.json() as { status: string; version: string }
    expect(body.status).toBe('ok')
    expect(body).toHaveProperty('version')
    expect(res.headers.get('Cache-Control')).toBe('no-store')
  })

  it('returns 503 when DB query throws', async () => {
    mockTransaction.mockRejectedValueOnce(new Error('connection refused'))
    const req = new Request('http://localhost/api/health')
    const res = await GET(req)

    expect(res.status).toBe(503)
    const body = await res.json() as { status: string }
    expect(body.status).toBe('error')
    expect(res.headers.get('Cache-Control')).toBe('no-store')
  })

  it('returns 503 and does not expose error message in body', async () => {
    mockTransaction.mockRejectedValueOnce(new Error('internal DB error details'))
    const req = new Request('http://localhost/api/health')
    const res = await GET(req)

    expect(res.status).toBe(503)
    const text = await res.text()
    expect(text).not.toContain('internal DB error details')
  })

  it('returns 503 after 2s timeout when DB never responds', async () => {
    vi.useFakeTimers()
    mockTransaction.mockReturnValueOnce(new Promise<void>(() => { /* never resolves */ }))

    const req = new Request('http://localhost/api/health')
    const responsePromise = GET(req)

    await vi.advanceTimersByTimeAsync(2001)

    const res = await responsePromise
    expect(res.status).toBe(503)
    vi.useRealTimers()
  })
})
