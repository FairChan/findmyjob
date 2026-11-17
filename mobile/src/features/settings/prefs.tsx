import * as SecureStore from 'expo-secure-store'
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'

import { AppIntlProvider, deviceLocale } from '@/i18n/provider'
import { LOCALES, type AppLocale } from '@/i18n/messages'
import { ThemePreferenceContext, type ThemePreference } from '@/theme/use-theme'

// 语言和深浅色只是本机偏好（不是秘密），放 SecureStore 是为了不为两个字符串再引一个存储依赖；
// 用同步读：首帧就用对语言和配色，不闪一下。
const LOCALE_KEY = 'findmyjob.pref.locale'
const THEME_KEY = 'findmyjob.pref.theme'
const THEMES: readonly ThemePreference[] = ['system', 'light', 'dark']

function read(key: string): string | null {
  try {
    return SecureStore.getItem(key)
  } catch {
    return null
  }
}

function write(key: string, value: string): void {
  try {
    SecureStore.setItem(key, value)
  } catch {
    // 写不进去只影响下次启动的默认值，当前会话照样生效
  }
}

export function storedLocale(): AppLocale | null {
  const v = read(LOCALE_KEY)
  return v && (LOCALES as readonly string[]).includes(v) ? (v as AppLocale) : null
}

export function storedTheme(): ThemePreference {
  const v = read(THEME_KEY)
  return v && (THEMES as readonly string[]).includes(v) ? (v as ThemePreference) : 'system'
}

type Prefs = {
  locale: AppLocale
  setLocale: (l: AppLocale) => void
  theme: ThemePreference
  setTheme: (t: ThemePreference) => void
}

const PrefsContext = createContext<Prefs>({ locale: 'zh', setLocale: () => {}, theme: 'system', setTheme: () => {} })

export function usePreferences(): Prefs {
  return useContext(PrefsContext)
}

/** 根布局用：语言立即生效（换 IntlProvider 的 locale），深浅色通过 ThemePreferenceContext 传给 useTheme */
export function PreferencesProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<AppLocale>(() => storedLocale() ?? deviceLocale())
  const [theme, setThemeState] = useState<ThemePreference>(storedTheme)
  const setLocale = useCallback((l: AppLocale) => {
    write(LOCALE_KEY, l)
    setLocaleState(l)
  }, [])
  const setTheme = useCallback((t: ThemePreference) => {
    write(THEME_KEY, t)
    setThemeState(t)
  }, [])
  const value = useMemo(() => ({ locale, setLocale, theme, setTheme }), [locale, setLocale, theme, setTheme])
  return (
    <PrefsContext.Provider value={value}>
      <ThemePreferenceContext.Provider value={theme}>
        <AppIntlProvider locale={locale}>{children}</AppIntlProvider>
      </ThemePreferenceContext.Provider>
    </PrefsContext.Provider>
  )
}
