/**
 * Guards for the production image build (deploy/Dockerfile). Each case is a failure the first
 * real staging build hit on 2026-11-08 (findmyjob-plan/.reports/2026-11-08-staging-deploy.md).
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, existsSync, statSync } from 'fs'
import path from 'path'

const root = path.resolve(__dirname, '../..')
const read = (rel: string) => readFileSync(path.join(root, rel), 'utf8')

describe('deploy/Dockerfile build inputs', () => {
  it('installs exactly the pnpm version pinned in package.json packageManager (corepack in node:24.4.0 cannot run pnpm 12)', () => {
    const pinned = (JSON.parse(read('package.json')) as { packageManager: string }).packageManager
    expect(pinned).toMatch(/^pnpm@\d+\.\d+\.\d+$/)
    const dockerfile = read('deploy/Dockerfile')
    expect(dockerfile).toContain(`npm install -g ${pinned}`)
    expect(dockerfile).not.toMatch(/^RUN corepack enable/m)
  })

  it('.dockerignore excludes tests/ and every root config file that imports from ./tests/', () => {
    const ignored = read('.dockerignore')
      .split('\n')
      .map(l => l.trim())
      .filter(l => l && !l.startsWith('#'))
    expect(ignored).toContain('tests')
    const rootTs = readdirSync(root).filter(f => /\.(m?ts)$/.test(f) && !f.endsWith('.d.ts'))
    const importingTests = rootTs.filter(f => /from ['"]\.\/tests\//.test(read(f)))
    expect(importingTests.length).toBeGreaterThan(0)
    for (const f of importingTests) expect(ignored, `${f} imports ./tests/ but is not in .dockerignore`).toContain(f)
  })

  it('public/ exists, because the runner stage copies /app/public', () => {
    expect(read('deploy/Dockerfile')).toMatch(/COPY --from=builder[^\n]*\/app\/public/)
    expect(existsSync(path.join(root, 'public')) && statSync(path.join(root, 'public')).isDirectory()).toBe(true)
  })
})
