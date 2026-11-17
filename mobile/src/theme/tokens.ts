// 取值与 Web 的 src/app/globals.css 保持一致（:root 与 .dark）；MA2-T01 会加漂移检查脚本。
export const colors = {
  light: {
    background: 'hsl(0, 0%, 100%)',
    foreground: 'hsl(240, 3%, 12%)',
    muted: 'hsl(240, 11%, 96%)',
    mutedForeground: 'hsl(240, 2%, 42%)',
    border: 'hsl(240, 6%, 90%)',
    destructive: 'hsl(4, 74%, 42%)',
    brand: 'hsl(210, 100%, 40%)',
    brandForeground: 'hsl(0, 0%, 100%)',
    brandMuted: 'hsl(210, 100%, 96%)',
    brandMutedForeground: 'hsl(210, 100%, 30%)',
  },
  dark: {
    background: 'hsl(222.2, 84%, 4.9%)',
    foreground: 'hsl(210, 40%, 98%)',
    muted: 'hsl(217.2, 32.6%, 17.5%)',
    mutedForeground: 'hsl(215, 20.2%, 65.1%)',
    border: 'hsl(217.2, 32.6%, 17.5%)',
    destructive: 'hsl(0, 62.8%, 30.6%)',
    brand: 'hsl(210, 100%, 62%)',
    brandForeground: 'hsl(0, 0%, 100%)',
    brandMuted: 'hsl(210, 50%, 15%)',
    brandMutedForeground: 'hsl(210, 80%, 78%)',
  },
} as const

export type ColorScheme = keyof typeof colors
export type Palette = { [K in keyof (typeof colors)['light']]: string }

export const radius = { button: 12, card: 16, pill: 999 } as const
export const spacing = { page: 16, unit: 4 } as const
// Android 触控目标下限（MOBILE.md §5.1）
export const minTouchTarget = 48

export function paletteFor(scheme: string | null | undefined): Palette {
  return scheme === 'dark' ? colors.dark : colors.light
}
