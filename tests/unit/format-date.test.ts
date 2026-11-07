import { describe, it, expect } from 'vitest'
import { formatKLDate } from '@/lib/format-date'

describe('formatKLDate', () => {
  it('shows 2026-11-04T17:00:00Z as November 5 in en-MY (KL is UTC+8)', () => {
    const result = formatKLDate(new Date('2026-11-04T17:00:00Z'), 'en')
    // 17:00 UTC = 01:00 KL next day (UTC+8)
    expect(result).toContain('5')
    expect(result).toContain('November')
    expect(result).toContain('2026')
  })

  it('shows 2026-11-04T17:00:00Z as 11月5日 in zh', () => {
    const result = formatKLDate(new Date('2026-11-04T17:00:00Z'), 'zh')
    // 17:00 UTC = 01:00 KL (UTC+8) → 2026年11月5日
    expect(result).toContain('5')
    expect(result).toContain('11')
    expect(result).toContain('2026')
  })

  it('shows 2026-11-04T15:00:00Z as November 4 in en-MY (UTC+8 = 23:00 same day)', () => {
    const result = formatKLDate(new Date('2026-11-04T15:00:00Z'), 'en')
    // 15:00 UTC = 23:00 KL same day
    expect(result).toContain('4')
    expect(result).toContain('November')
  })

  it('accepts a string date', () => {
    const result = formatKLDate('2026-11-04T17:00:00Z', 'en')
    expect(result).toContain('5')
  })
})
