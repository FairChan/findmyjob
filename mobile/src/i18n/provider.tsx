import { getLocales } from 'expo-localization'
import type { ReactNode } from 'react'
import { IntlProvider } from 'use-intl'

import { MESSAGES, resolveLocale, type AppLocale } from './messages'

// 和 Web 一致：时间按 UTC 存、按吉隆坡时间显示
export const DISPLAY_TIME_ZONE = 'Asia/Kuala_Lumpur'

/** 系统语言是英文就用英文，其余（中文、马来文等）默认中文；设置页可以改（MA2-T09） */
export function deviceLocale(): AppLocale {
  try {
    return resolveLocale(getLocales()[0]?.languageTag)
  } catch {
    return 'zh'
  }
}

export function AppIntlProvider({ locale, children }: { locale: AppLocale; children: ReactNode }) {
  return (
    <IntlProvider locale={locale} messages={MESSAGES[locale]} timeZone={DISPLAY_TIME_ZONE}>
      {children}
    </IntlProvider>
  )
}
