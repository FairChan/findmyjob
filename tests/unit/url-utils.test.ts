import { describe, it, expect } from 'vitest'
import { safeWebsiteHref } from '@/lib/url-utils'

describe('safeWebsiteHref', () => {
  it('returns http url unchanged', () => {
    expect(safeWebsiteHref('http://example.com')).toBe('http://example.com')
  })

  it('returns https url unchanged', () => {
    expect(safeWebsiteHref('https://example.com/path?q=1')).toBe('https://example.com/path?q=1')
  })

  it('returns null for javascript: protocol', () => {
    expect(safeWebsiteHref('javascript:alert(1)')).toBeNull()
  })

  it('returns null for data: protocol', () => {
    expect(safeWebsiteHref('data:text/html,<script>alert(1)</script>')).toBeNull()
  })

  it('returns null for ftp: protocol', () => {
    expect(safeWebsiteHref('ftp://files.example.com')).toBeNull()
  })

  it('returns null for null input', () => {
    expect(safeWebsiteHref(null)).toBeNull()
  })

  it('returns null for undefined input', () => {
    expect(safeWebsiteHref(undefined)).toBeNull()
  })

  it('returns null for empty string', () => {
    expect(safeWebsiteHref('')).toBeNull()
  })

  it('returns null for unparseable string', () => {
    expect(safeWebsiteHref('not a url at all')).toBeNull()
  })
})
