import { describe, it, expect, vi } from 'vitest'

// Mock env before importing storage (storage.ts reads env at module level)
vi.mock('@/env', () => ({
  env: {
    S3_ENDPOINT: 'http://localhost:9010',
    S3_REGION: 'us-east-1',
    S3_BUCKET: 'findmyjob-dev',
    S3_ACCESS_KEY_ID: 'minioadmin',
    S3_SECRET_ACCESS_KEY: 'minioadmin',
  },
}))

import { SIGNED_URL_EXPIRES_SECONDS } from '@/lib/storage'
import { detectFileType, isPdfEncrypted, getPdfPageCount } from '@/server/lib/pdf'

describe('SIGNED_URL_EXPIRES_SECONDS', () => {
  it('is at most 300 seconds', () => {
    expect(SIGNED_URL_EXPIRES_SECONDS).toBeLessThanOrEqual(300)
    expect(SIGNED_URL_EXPIRES_SECONDS).toBeGreaterThan(0)
  })
})

describe('detectFileType', () => {
  it('detects PDF from magic bytes', () => {
    const buf = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(100)])
    expect(detectFileType(buf)).toBe('pdf')
  })

  it('detects PNG from magic bytes', () => {
    const buf = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    expect(detectFileType(buf)).toBe('png')
  })

  it('detects JPEG from magic bytes', () => {
    const buf = Buffer.from([0xff, 0xd8, 0xff, 0xe0])
    expect(detectFileType(buf)).toBe('jpeg')
  })

  it('returns null for executable renamed as pdf', () => {
    // MZ header (Windows executable)
    const buf = Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00])
    expect(detectFileType(buf)).toBeNull()
  })

  it('returns null for empty buffer', () => {
    expect(detectFileType(Buffer.alloc(0))).toBeNull()
  })

  it('returns null for SVG (XML)', () => {
    const buf = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>')
    expect(detectFileType(buf)).toBeNull()
  })

  it('returns null for HTML', () => {
    const buf = Buffer.from('<!DOCTYPE html><html></html>')
    expect(detectFileType(buf)).toBeNull()
  })
})

describe('isPdfEncrypted', () => {
  it('detects /Encrypt marker in tail', () => {
    const tail = Buffer.alloc(100)
    const marker = Buffer.from('/Encrypt 10 0 R')
    const buf = Buffer.concat([Buffer.alloc(100), marker, tail])
    expect(isPdfEncrypted(buf)).toBe(true)
  })

  it('returns false for a plain PDF without /Encrypt', () => {
    const buf = Buffer.from('%PDF-1.4\nsome content\n%%EOF\n')
    expect(isPdfEncrypted(buf)).toBe(false)
  })
})

describe('getPdfPageCount', () => {
  it('extracts page count from /Count N', () => {
    const pdf = Buffer.from(
      '%PDF-1.4\n<</Type /Pages /Count 5 /Kids []>>\nxref\ntrailer\n%%EOF\n',
    )
    expect(getPdfPageCount(pdf)).toBe(5)
  })

  it('returns max /Count for nested page tree', () => {
    const pdf = Buffer.from(
      '<</Count 3>><</Count 2>><</Count 5>>\n%%EOF\n',
    )
    expect(getPdfPageCount(pdf)).toBe(5)
  })

  it('throws if no /Count found', () => {
    const pdf = Buffer.from('%PDF-1.4\nno pages here\n%%EOF\n')
    expect(() => getPdfPageCount(pdf)).toThrow()
  })
})
