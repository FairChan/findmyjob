import { describe, it, expect } from 'vitest'
import { purposeSchema, validateFileName } from '@/server/lib/upload-input'

describe('purposeSchema', () => {
  it.each(['RESUME', 'VERIFICATION', 'PAYMENT_PROOF', 'LOGO'])('accepts valid purpose %s', purpose => {
    expect(purposeSchema.safeParse(purpose).success).toBe(true)
  })

  it.each(['resume', 'other', '', 'ADMIN', '../etc'])('rejects invalid purpose %s', purpose => {
    expect(purposeSchema.safeParse(purpose).success).toBe(false)
  })
})

describe('validateFileName', () => {
  it('passes through a normal filename', () => {
    const r = validateFileName('my-resume.pdf')
    expect(r).toEqual({ ok: true, name: 'my-resume.pdf' })
  })

  it('rejects empty string', () => {
    expect(validateFileName('')).toEqual({ ok: false })
  })

  it('rejects whitespace-only string', () => {
    expect(validateFileName('   ')).toEqual({ ok: false })
  })

  it('rejects name that becomes empty after stripping control chars', () => {
    expect(validateFileName('\u0000\u001f')).toEqual({ ok: false })
  })

  it('rejects 256-character name', () => {
    expect(validateFileName('a'.repeat(256))).toEqual({ ok: false })
  })

  it('accepts 255-character name', () => {
    const r = validateFileName('a'.repeat(255))
    expect(r).toEqual({ ok: true, name: 'a'.repeat(255) })
  })

  it('strips bidi override characters (U+202A–U+202E)', () => {
    const r = validateFileName('resume‮.pdf')
    expect(r).toEqual({ ok: true, name: 'resume.pdf' })
  })

  it('strips bidi isolate characters (U+2066–U+2069)', () => {
    const r = validateFileName('⁦hidden⁩name.pdf')
    expect(r).toEqual({ ok: true, name: 'hiddenname.pdf' })
  })

  it('strips C0 control characters', () => {
    const r = validateFileName('file\u0000name.pdf')
    expect(r).toEqual({ ok: true, name: 'filename.pdf' })
  })

  it('strips C1 control characters (U+0080–U+009F)', () => {
    const r = validateFileName('file\u0085name.pdf')
    expect(r).toEqual({ ok: true, name: 'filename.pdf' })
  })

  it('strips U+200E and U+200F (LRM/RLM)', () => {
    const r = validateFileName('‎name‏.pdf')
    expect(r).toEqual({ ok: true, name: 'name.pdf' })
  })

  it('strips U+061C (Arabic Letter Mark)', () => {
    const r = validateFileName('na؜me.pdf')
    expect(r).toEqual({ ok: true, name: 'name.pdf' })
  })
})
