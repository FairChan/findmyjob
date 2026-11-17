/**
 * Architecture test (MA1-T06): which routes the Android app may call.
 * - Every route() under src/app/api/m/ must declare origin: 'app' (App only, browsers rejected).
 * - origin: 'web+app' is allowed only on the upload endpoint; every other route keeps the web default,
 *   so an app-origin request to them is still refused.
 */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const API = path.resolve(__dirname, '../../src/app/api')
const UPLOAD_ROUTE = 'uploads/[purpose]/route.ts'

function routeFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name)
    return e.isDirectory() ? routeFiles(p) : e.name === 'route.ts' ? [p] : []
  })
}

const rel = (p: string) => path.relative(API, p).replace(/\\/g, '/')

describe('app origin routes', () => {
  const files = routeFiles(API)

  it('every /api/m route() call is origin app', () => {
    const bad: string[] = []
    for (const file of files.filter((f) => rel(f).startsWith('m/'))) {
      const src = fs.readFileSync(file, 'utf8')
      const calls = src.match(/route\(\s*\{[^}]*\}/g) ?? []
      if (calls.length === 0) bad.push(`${rel(file)}: no route() call`)
      for (const call of calls) if (!/origin:\s*'app'/.test(call)) bad.push(`${rel(file)}: ${call}`)
    }
    expect(bad).toEqual([])
  })

  it("only the upload endpoint opts into origin 'web+app'", () => {
    const users = files.filter((f) => /origin:\s*'web\+app'/.test(fs.readFileSync(f, 'utf8'))).map(rel)
    expect(users).toEqual([UPLOAD_ROUTE])
  })
})
