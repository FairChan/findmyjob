import type { ReactNode } from 'react'
import { IntlProvider } from 'use-intl'

import { MESSAGES, resolveLocale, type AppLocale } from './messages'

// 和 Web 一致：时间按 UTC 存、按吉隆坡时间显示
export const DISPLAY_TIME_ZONE = 'Asia/Kuala_Lumpur'

export function deviceLocale(): AppLocale {
  return resolveLocale(Intl.DateTimeFormat().resolvedOptions().locale)
}

export function AppIntlProvider({ locale, children }: { locale: AppLocale; children: ReactNode }) {
  return (
    <IntlProvider locale={locale} messages={MESSAGES[locale]} timeZone={DISPLAY_TIME_ZONE}>
      {children}
    </IntlProvider>
  )
}
