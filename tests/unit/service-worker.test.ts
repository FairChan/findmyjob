/**
 * Runs the real public/sw.js in a sandbox and fires fetch events at it (M7-T17 follow-up).
 * The service worker must only take over the app's own page navigations: the Mailpit inbox at
 * /_mail/ (basic-auth prompt) and the API / Next asset paths must go straight to the network,
 * otherwise some browsers show a bare 401 instead of the password prompt.
 */
import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import vm from 'node:vm'

type FetchEvent = {
  request: { mode: string; url: string }
  respondWith: ReturnType<typeof vi.fn>
}

function loadFetchHandler(): (event: FetchEvent) => void {
  const handlers: Record<string, (event: never) => void> = {}
  const sandbox = {
    self: {
      location: { origin: 'https://app.example.test' },
      addEventListener: (type: string, fn: (event: never) => void) => {
        handlers[type] = fn
      },
      skipWaiting: () => {},
      clients: { claim: () => {} },
    },
    caches: { open: async () => ({ addAll: async () => {} }), keys: async () => [], match: async () => undefined },
    fetch: async () => new Response('ok'),
    Response,
    URL,
  }
  vm.runInNewContext(readFileSync(join(process.cwd(), 'public', 'sw.js'), 'utf8'), sandbox)
  return handlers.fetch as (event: FetchEvent) => void
}

function fire(url: string, mode = 'navigate') {
  const handler = loadFetchHandler()
  const event: FetchEvent = { request: { mode, url }, respondWith: vi.fn() }
  handler(event)
  return event
}

describe('public/sw.js fetch handler', () => {
  it('takes over page navigations on the app origin', () => {
    expect(fire('https://app.example.test/zh/jobs').respondWith).toHaveBeenCalledTimes(1)
    expect(fire('https://app.example.test/').respondWith).toHaveBeenCalledTimes(1)
  })

  it('does not handle the Mailpit inbox under /_mail/', () => {
    expect(fire('https://app.example.test/_mail/').respondWith).not.toHaveBeenCalled()
    expect(fire('https://app.example.test/_mail/view/abc').respondWith).not.toHaveBeenCalled()
    expect(fire('https://app.example.test/_mail').respondWith).not.toHaveBeenCalled()
  })

  it('does not handle API or Next internal paths', () => {
    expect(fire('https://app.example.test/api/auth/verify-email?token=x').respondWith).not.toHaveBeenCalled()
    expect(fire('https://app.example.test/_next/static/chunk.js').respondWith).not.toHaveBeenCalled()
  })

  it('does not handle navigations to other origins', () => {
    expect(fire('https://elsewhere.example.test/zh/jobs').respondWith).not.toHaveBeenCalled()
  })

  it('does not handle non-navigation requests', () => {
    expect(fire('https://app.example.test/zh/jobs', 'cors').respondWith).not.toHaveBeenCalled()
    expect(fire('https://app.example.test/zh/jobs', 'no-cors').respondWith).not.toHaveBeenCalled()
  })

  it('a path that merely starts with the same letters is still handled', () => {
    expect(fire('https://app.example.test/_mailbox-help').respondWith).toHaveBeenCalledTimes(1)
  })
})
