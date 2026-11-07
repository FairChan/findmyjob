import { describe, it, expect } from 'vitest'
import { isSafePath } from '@/server/lib/is-safe-path'

// A valid cuid: starts with c, alphanumeric, length ≥25
const CUID = 'clh7t2kj00000mv0p1234abcd'

describe('isSafePath', () => {
  it('allows /zh/jobs/<cuid>', () => {
    expect(isSafePath(`/zh/jobs/${CUID}`, 'STUDENT', 'zh')).toBe(true)
  })

  it('allows /en/jobs/<cuid>', () => {
    expect(isSafePath(`/en/jobs/${CUID}`, 'STUDENT', 'en')).toBe(true)
  })

  it('allows /zh/jobs/<cuid> for EMPLOYER role', () => {
    expect(isSafePath(`/zh/jobs/${CUID}`, 'EMPLOYER', 'zh')).toBe(true)
  })

  it('rejects /zh/jobs/<cuid>/x (extra segment)', () => {
    expect(isSafePath(`/zh/jobs/${CUID}/x`, 'STUDENT', 'zh')).toBe(false)
  })

  it('rejects /zh/jobs/<cuid>?a=1 (query string)', () => {
    expect(isSafePath(`/zh/jobs/${CUID}?a=1`, 'STUDENT', 'zh')).toBe(false)
  })

  it('rejects /zh/jobs/<cuid>#x (fragment)', () => {
    expect(isSafePath(`/zh/jobs/${CUID}#x`, 'STUDENT', 'zh')).toBe(false)
  })

  it('rejects //evil.example/zh/jobs/x (protocol-relative)', () => {
    expect(isSafePath('//evil.example/zh/jobs/x', 'STUDENT', 'zh')).toBe(false)
  })

  it('rejects /zh/jobs/../admin (path traversal)', () => {
    expect(isSafePath('/zh/jobs/../admin', 'STUDENT', 'zh')).toBe(false)
  })

  it('rejects /zh/jobs/%2E%2E%2Fadmin (encoded traversal)', () => {
    expect(isSafePath('/zh/jobs/%2E%2E%2Fadmin', 'STUDENT', 'zh')).toBe(false)
  })

  it('rejects /zh/jobs/<cuid>%2Fx (encoded slash after cuid)', () => {
    expect(isSafePath(`/zh/jobs/${CUID}%2Fx`, 'STUDENT', 'zh')).toBe(false)
  })

  it('rejects /zh%2Fjobs/<cuid> (encoded slash in prefix)', () => {
    expect(isSafePath(`/zh%2Fjobs/${CUID}`, 'STUDENT', 'zh')).toBe(false)
  })

  it('rejects /zh/jobs/%E0%A4%A (invalid UTF-8 sequence — decodeURIComponent throws)', () => {
    expect(isSafePath('/zh/jobs/%E0%A4%A', 'STUDENT', 'zh')).toBe(false)
  })

  it('rejects /fr/jobs/<cuid> (unsupported locale)', () => {
    expect(isSafePath(`/fr/jobs/${CUID}`, 'STUDENT', 'fr')).toBe(false)
  })

  it('rejects https://evil.example/zh/jobs/<cuid> (absolute URL)', () => {
    expect(isSafePath(`https://evil.example/zh/jobs/${CUID}`, 'STUDENT', 'zh')).toBe(false)
  })

  it('rejects /zh/jobs\\evil (backslash)', () => {
    expect(isSafePath('/zh/jobs\\evil', 'STUDENT', 'zh')).toBe(false)
  })

  it('still allows STUDENT /zh/s/ paths', () => {
    expect(isSafePath('/zh/s/dashboard', 'STUDENT', 'zh')).toBe(true)
  })

  it('still allows EMPLOYER /zh/e/ paths', () => {
    expect(isSafePath('/zh/e/dashboard', 'EMPLOYER', 'zh')).toBe(true)
  })
})
