import { describe, expect, it } from 'vitest'
import * as dateFormat from '@/lib/format-date'

type DateTimeFormatter = (date: Date | string, locale: string) => string

describe('M4-T17: shared KL audit timestamps retain seconds', () => {
  it.each([
    ['en', '2026-11-04T17:02:03.000Z', '5 November 2026, 01:02:03'],
    ['zh', '2026-11-04T17:02:03.000Z', '2026年11月5日 01:02:03'],
    ['en', '2026-12-31T16:00:00.000Z', '1 January 2027, 00:00:00'],
    ['zh', '2026-12-31T16:00:00.000Z', '2027年1月1日 00:00:00'],
  ] as const)('%s formats %s as the complete localized KL timestamp', (locale, input, expected) => {
    // Assert the missing API explicitly so the initial failure is a requirement,
    // not an import-time crash; the date-only formatter must remain unchanged.
    expect(dateFormat).toHaveProperty('formatKLDateTime')
    const format = (dateFormat as unknown as { formatKLDateTime: DateTimeFormatter }).formatKLDateTime
    expect(format(input, locale)).toBe(expected)
    expect(format(new Date(input), locale)).toBe(expected)
  })
})
