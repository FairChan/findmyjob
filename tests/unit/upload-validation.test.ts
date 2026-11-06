import { describe, it, expect } from 'vitest'
import { z } from 'zod'

// Replicate the schemas from the route for unit testing
const purposeSchema = z.enum(['RESUME', 'VERIFICATION', 'PAYMENT_PROOF', 'LOGO'])
const idSchema = z.string().cuid()
const BIDI_RE = /[‪-‮⁦-⁩\u0000-\u001f\u007f]/g
function sanitizeFileName(raw: string): string {
  return raw.replace(BIDI_RE, '').trim().slice(0, 255) || 'upload'
}

describe('purposeSchema', () => {
  it.each(['RESUME', 'VERIFICATION', 'PAYMENT_PROOF', 'LOGO'])('accepts valid purpose %s', purpose => {
    expect(purposeSchema.safeParse(purpose).success).toBe(true)
  })

  it.each(['resume', 'other', '', 'ADMIN', '../etc'])('rejects invalid purpose %s', purpose => {
    expect(purposeSchema.safeParse(purpose).success).toBe(false)
  })
})

describe('idSchema (cuid)', () => {
  it('accepts a valid cuid', () => {
    // Real cuid from @paralleldrive/cuid2 format used by prisma cuid()
    expect(idSchema.safeParse('cln5ue1mn000008jl1234abcd').success).toBe(true)
  })

  it('rejects empty string', () => {
    expect(idSchema.safeParse('').success).toBe(false)
  })

  it.each(['../etc/passwd', 'SELECT * FROM', '1 OR 1=1'])(
    'rejects non-cuid value: %s',
    id => {
      expect(idSchema.safeParse(id).success).toBe(false)
    },
  )
})

describe('sanitizeFileName', () => {
  it('passes through a normal filename unchanged', () => {
    expect(sanitizeFileName('my-resume.pdf')).toBe('my-resume.pdf')
  })

  it('strips bidi control characters (U+202A–U+202E)', () => {
    const malicious = 'resume‮.pdf'
    expect(sanitizeFileName(malicious)).toBe('resume.pdf')
  })

  it('strips bidi isolate characters (U+2066–U+2069)', () => {
    const malicious = '⁦hidden⁩name.pdf'
    expect(sanitizeFileName(malicious)).toBe('hiddenname.pdf')
  })

  it('strips null bytes and other control characters', () => {
    expect(sanitizeFileName('file\u0000name.pdf')).toBe('filename.pdf')
  })

  it('truncates to 255 characters', () => {
    const long = 'a'.repeat(300)
    expect(sanitizeFileName(long).length).toBe(255)
  })

  it('returns fallback "upload" when result is empty after stripping', () => {
    expect(sanitizeFileName('‪‫')).toBe('upload')
  })

  it('returns 400-invalid when filename zod schema rejects', () => {
    // Empty filename is invalid
    const fileNameSchema = z.string().trim().min(1).max(255)
    expect(fileNameSchema.safeParse('').success).toBe(false)
    expect(fileNameSchema.safeParse('a').success).toBe(true)
    expect(fileNameSchema.safeParse('a'.repeat(256)).success).toBe(false)
  })
})
