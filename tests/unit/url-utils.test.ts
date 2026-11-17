import { describe, it, expect } from 'vitest'
import { normalizeWebsiteInput, safeWebsiteHref } from '@/lib/url-utils'

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

describe('normalizeWebsiteInput', () => {
  it('assumes https:// for what people usually type', () => {
    expect(normalizeWebsiteInput('abc.com.my')).toBe('https://abc.com.my')
    expect(normalizeWebsiteInput('  www.example.com/careers ')).toBe('https://www.example.com/careers')
    expect(normalizeWebsiteInput('localhost:3000')).toBe('https://localhost:3000')
  })

  it('keeps an explicit scheme so validation can still reject unsafe ones', () => {
    expect(normalizeWebsiteInput('http://example.com')).toBe('http://example.com')
    expect(normalizeWebsiteInput('javascript:alert(1)')).toBe('javascript:alert(1)')
  })

  it('treats blank as not provided', () => {
    expect(normalizeWebsiteInput('   ')).toBeUndefined()
    expect(normalizeWebsiteInput(undefined)).toBeUndefined()
  })
})
