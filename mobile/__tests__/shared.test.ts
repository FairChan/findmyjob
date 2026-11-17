import { compareAppVersions, isKnownMobileErrorCode, MOBILE_API_PREFIX } from '@shared/mobile-api'
import { z } from 'zod'

import { MESSAGES, resolveLocale } from '@/i18n/messages'

describe('shared layer', () => {
  it('imports the API protocol shared with the web server', () => {
    expect(MOBILE_API_PREFIX).toBe('/api/m/v1')
    expect(compareAppVersions('0.2.0', '0.1.9')).toBe(1)
    expect(isKnownMobileErrorCode('APP_UPDATE_REQUIRED')).toBe(true)
  })

  it('uses zod from mobile/node_modules', () => {
    expect(z.string().safeParse('x').success).toBe(true)
  })

  it('loads web messages for both locales', () => {
    expect(MESSAGES.zh.notFound.title).toBeTruthy()
    expect(MESSAGES.en.notFound.title).toBeTruthy()
    expect(resolveLocale('en-MY')).toBe('en')
    expect(resolveLocale('zh-Hans-CN')).toBe('zh')
    expect(resolveLocale(undefined)).toBe('zh')
  })
})
