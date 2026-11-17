/**
 * Architecture test: src/shared/** is imported by both the Next.js server and the Android app
 * (mobile/). It must stay free of server-only, Prisma, Next.js and React Native imports.
 */
import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const SHARED = path.join(__dirname, '..', '..', 'src', 'shared')
const FORBIDDEN = [/^server-only$/, /^@prisma\//, /^next(\/|$)/, /^next-intl/, /^react-native/, /^expo/, /^@\/(?!shared\/)/, /^node:/]

function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name)
    return e.isDirectory() ? walk(p) : /\.tsx?$/.test(e.name) ? [p] : []
  })
}

describe('src/shared boundary', () => {
  it('has only portable imports', () => {
    const bad: string[] = []
    for (const file of walk(SHARED)) {
      const src = fs.readFileSync(file, 'utf8')
      for (const m of src.matchAll(/(?:import|export)[^'"]*from\s+['"]([^'"]+)['"]|import\s+['"]([^'"]+)['"]/g)) {
        const spec = m[1] ?? m[2] ?? ''
        if (FORBIDDEN.some((re) => re.test(spec))) bad.push(`${path.relative(SHARED, file)} → ${spec}`)
      }
    }
    expect(bad).toEqual([])
  })
})
