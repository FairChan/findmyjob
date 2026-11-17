import { readFileSync } from 'fs'
import { join } from 'path'

import { colors, paletteFor } from '@/theme/tokens'

// 防止 App 和 Web 的品牌色悄悄漂移：直接对照 Web 的 globals.css
const css = readFileSync(join(__dirname, '..', '..', 'src', 'app', 'globals.css'), 'utf8')

function webToken(block: 'root' | 'dark', name: string): string {
  const start = block === 'root' ? css.indexOf(':root {') : css.indexOf('.dark {')
  const body = css.slice(start, css.indexOf('}', start))
  const m = body.match(new RegExp(`--${name}:\s*([^;]+);`))
  if (!m?.[1]) throw new Error(`token --${name} not found in ${block}`)
  return m[1].trim()
}

function toHsl(raw: string): string {
  const [h, s, l] = raw.split(/\s+/)
  return `hsl(${h}, ${s}, ${l})`
}

describe('theme tokens', () => {
  it.each([
    ['background', 'background'],
    ['foreground', 'foreground'],
    ['muted', 'muted'],
    ['muted-foreground', 'mutedForeground'],
    ['border', 'border'],
    ['destructive', 'destructive'],
    ['brand', 'brand'],
    ['brand-foreground', 'brandForeground'],
    ['brand-muted', 'brandMuted'],
    ['brand-muted-foreground', 'brandMutedForeground'],
  ] as const)('%s matches web in light and dark', (cssName, key) => {
    expect(colors.light[key]).toBe(toHsl(webToken('root', cssName)))
    expect(colors.dark[key]).toBe(toHsl(webToken('dark', cssName)))
  })

  it('falls back to light palette', () => {
    expect(paletteFor(null)).toBe(colors.light)
    expect(paletteFor('dark')).toBe(colors.dark)
  })
})
