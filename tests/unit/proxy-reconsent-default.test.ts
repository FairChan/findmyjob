/**
 * Without INTERNAL_BASE_URL, the re-consent check must call the app on its own PORT.
 * A hard-coded :3000 default sends lane B's dev server (PORT=3001) to a different
 * process; the check then fails open and re-consent is never enforced locally.
 */
import { describe, it, expect, vi } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

// Set BEFORE the proxy module is imported: the base URL is read at module load.
delete process.env.INTERNAL_BASE_URL
process.env.PORT = '4321'

vi.mock('next-intl/middleware', () => ({ default: () => () => NextResponse.next() }))

const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

const { default: middleware } = await import('@/proxy')

describe('checkReconsent default internal base URL', () => {
  it('uses http://127.0.0.1:<PORT> when INTERNAL_BASE_URL is not set', async () => {
    mockFetch.mockResolvedValue(
      new Response(JSON.stringify({ needsReconsent: false }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
    const req = new NextRequest(new URL('/zh', 'https://app.example.test'), {
      headers: { cookie: 'better-auth.session_token=abc.def' },
    })
    await middleware(req)

    const calledUrls = mockFetch.mock.calls.map(args => String(args[0]))
    expect(calledUrls).toContain('http://127.0.0.1:4321/api/internal/needs-reconsent')
  })
})
