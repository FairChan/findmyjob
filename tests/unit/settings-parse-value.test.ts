import { describe, it, expect } from 'vitest'
import { parseSettingValue } from '@/app/[locale]/admin/settings/parse-value'

describe('parseSettingValue', () => {
  describe('numeric default', () => {
    it('converts a valid number string', () => {
      expect(parseSettingValue('42', 1)).toBe(42)
    })

    it('empty string returns empty string (not 0)', () => {
      expect(parseSettingValue('', 1)).toBe('')
      expect(parseSettingValue('', 1)).not.toBe(0)
    })

    it('whitespace-only string returns empty string (not 0)', () => {
      expect(parseSettingValue('  ', 1)).toBe('')
      expect(parseSettingValue('  ', 1)).not.toBe(0)
    })

    it('non-numeric string returns the trimmed string (server rejects)', () => {
      expect(parseSettingValue('abc', 1)).toBe('abc')
    })
  })

  describe('boolean default', () => {
    it('converts "true" to true', () => {
      expect(parseSettingValue('true', false)).toBe(true)
    })

    it('converts "false" to false', () => {
      expect(parseSettingValue('false', true)).toBe(false)
    })
  })

  describe('array default', () => {
    it('splits comma-separated numbers', () => {
      expect(parseSettingValue('1000, 2000, 3000', [1000])).toEqual([1000, 2000, 3000])
    })
  })

  describe('string default', () => {
    it('trims and returns the string', () => {
      expect(parseSettingValue('  v2  ', 'v1')).toBe('v2')
    })
  })
})
