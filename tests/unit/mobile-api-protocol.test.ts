import { describe, expect, it } from 'vitest'
import { compareAppVersions, isKnownMobileErrorCode, MOBILE_ERROR_CODES } from '@/shared/mobile-api'

describe('compareAppVersions', () => {
  it.each([
    ['1.0.0', '1.0.0', 0],
    ['1.0.1', '1.0.0', 1],
    ['1.2.0', '1.10.0', -1],
    ['2.0.0', '1.99.99', 1],
    ['garbage', '0.0.0', -1],
    [' 1.0.0 ', '1.0.0', 0],
  ])('%s vs %s → %d', (a, b, expected) => {
    expect(compareAppVersions(a, b)).toBe(expected)
  })
})

describe('mobile error codes', () => {
  it('has no duplicates and recognises known codes', () => {
    expect(new Set(MOBILE_ERROR_CODES).size).toBe(MOBILE_ERROR_CODES.length)
    expect(isKnownMobileErrorCode('NOT_FOUND')).toBe(true)
    expect(isKnownMobileErrorCode('SOMETHING_ELSE')).toBe(false)
  })
})
