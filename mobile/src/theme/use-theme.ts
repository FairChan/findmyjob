import { createContext, useContext } from 'react'
import { useColorScheme } from 'react-native'

import { minTouchTarget, paletteFor, radius, spacing, type Palette } from './tokens'

export type Theme = {
  scheme: 'light' | 'dark'
  colors: Palette
  radius: typeof radius
  spacing: typeof spacing
  minTouchTarget: number
}

export type ThemePreference = 'system' | 'light' | 'dark'

/** 设置页的"跟随系统 / 浅色 / 深色"（MA2-T09）；没有 Provider 时（单测）就跟随系统 */
export const ThemePreferenceContext = createContext<ThemePreference>('system')

export function useTheme(): Theme {
  const system = useColorScheme() === 'dark' ? 'dark' : 'light'
  const pref = useContext(ThemePreferenceContext)
  const scheme = pref === 'system' ? system : pref
  return { scheme, colors: paletteFor(scheme), radius, spacing, minTouchTarget }
}
