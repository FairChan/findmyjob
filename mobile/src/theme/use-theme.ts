import { useColorScheme } from 'react-native'

import { minTouchTarget, paletteFor, radius, spacing, type Palette } from './tokens'

export type Theme = {
  scheme: 'light' | 'dark'
  colors: Palette
  radius: typeof radius
  spacing: typeof spacing
  minTouchTarget: number
}

/** 跟随系统深浅色；设置页的"浅/深/跟随系统"在 MA2-T09 接入后从这里覆盖 */
export function useTheme(): Theme {
  const scheme = useColorScheme() === 'dark' ? 'dark' : 'light'
  return { scheme, colors: paletteFor(scheme), radius, spacing, minTouchTarget }
}
