/**
 * Unit tests for PWA manifest and service worker fetch-intercept logic.
 */
import { describe, it, expect } from 'vitest'
import manifest from '@/app/manifest'

// Pure function mirroring the fetch-intercept decision in public/sw.js.
// Only navigate requests should be intercepted; all others go straight to the network.
function shouldInterceptFetch(mode: string): boolean {
  return mode === 'navigate'
}

describe('ServiceWorker fetch interceptor', () => {
  it('intercepts navigate (page navigation) requests', () => {
    expect(shouldInterceptFetch('navigate')).toBe(true)
  })

  it('does not intercept cors requests', () => {
    expect(shouldInterceptFetch('cors')).toBe(false)
  })

  it('does not intercept no-cors requests', () => {
    expect(shouldInterceptFetch('no-cors')).toBe(false)
  })

  it('does not intercept same-origin non-navigate requests', () => {
    expect(shouldInterceptFetch('same-origin')).toBe(false)
  })

  it('does not intercept websocket requests', () => {
    expect(shouldInterceptFetch('websocket')).toBe(false)
  })
})

describe('manifest', () => {
  it('name and short_name are both FindMYJob', () => {
    const m = manifest()
    expect(m.name).toBe('FindMYJob')
    expect(m.short_name).toBe('FindMYJob')
  })

  it('start_url is /zh (default Chinese locale)', () => {
    const m = manifest()
    expect(m.start_url).toBe('/zh')
  })

  it('display is standalone', () => {
    const m = manifest()
    expect(m.display).toBe('standalone')
  })

  it('includes a 192×192 icon', () => {
    const m = manifest()
    const icon = m.icons?.find((i) => i.sizes === '192x192')
    expect(icon).toBeDefined()
    expect(icon?.type).toBe('image/png')
  })

  it('includes a 512×512 icon', () => {
    const m = manifest()
    const icon = m.icons?.find((i) => i.sizes === '512x512')
    expect(icon).toBeDefined()
    expect(icon?.type).toBe('image/png')
  })

  it('includes a maskable icon', () => {
    const m = manifest()
    const maskable = m.icons?.find((i) => i.purpose === 'maskable')
    expect(maskable).toBeDefined()
  })

  it('all icons declare type image/png', () => {
    const m = manifest()
    expect(m.icons).toBeDefined()
    const nonPng = m.icons!.filter((i) => i.type !== 'image/png')
    expect(nonPng).toHaveLength(0)
  })
})
