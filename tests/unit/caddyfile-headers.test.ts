import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'

const caddyfile = readFileSync(resolve(__dirname, '../../deploy/Caddyfile'), 'utf-8')

describe('Caddyfile security headers', () => {
  it('sets Strict-Transport-Security with default 300', () => {
    expect(caddyfile).toContain('Strict-Transport-Security')
    expect(caddyfile).toContain('{$HSTS_MAX_AGE:300}')
    expect(caddyfile).toContain('max-age=')
  })

  it('does not include includeSubDomains or preload in HSTS', () => {
    expect(caddyfile).not.toMatch(/includeSubDomains/i)
    expect(caddyfile).not.toMatch(/preload/i)
  })

  it('sets X-Content-Type-Options nosniff', () => {
    expect(caddyfile).toMatch(/X-Content-Type-Options\s+"?nosniff"?/)
  })

  it('sets Referrer-Policy strict-origin-when-cross-origin', () => {
    expect(caddyfile).toMatch(/Referrer-Policy\s+"?strict-origin-when-cross-origin"?/)
  })

  it('sets X-Frame-Options DENY', () => {
    expect(caddyfile).toMatch(/X-Frame-Options\s+"?DENY"?/)
  })

  it('removes Server header with - prefix', () => {
    expect(caddyfile).toMatch(/-Server/)
  })

  it('does not use + prefix on these security headers', () => {
    // Appending with + creates duplicate headers; all four must be plain set directives
    expect(caddyfile).not.toMatch(/\+\s*Strict-Transport-Security/)
    expect(caddyfile).not.toMatch(/\+\s*X-Content-Type-Options/)
    expect(caddyfile).not.toMatch(/\+\s*Referrer-Policy/)
    expect(caddyfile).not.toMatch(/\+\s*X-Frame-Options/)
  })
})
