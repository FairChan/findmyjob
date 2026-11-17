import { describe, expect, it } from 'vitest'
import { safeReturnPath } from '@/lib/safe-return-path'

describe('safeReturnPath', () => {
  it('returns to where the user was going', () => {
    expect(safeReturnPath('/zh/admin', 'zh')).toBe('/zh/admin')
    expect(safeReturnPath('/en/s/jobs/cmabc123', 'en')).toBe('/en/s/jobs/cmabc123')
    expect(safeReturnPath(['/zh/e/jobs'], 'zh')).toBe('/zh/e/jobs')
  })

  it('refuses anything that could leave the site or loop', () => {
    for (const bad of ['https://evil.example', '//evil.example', '/\\evil', '/zh/%2F%2Fevil', '/zh//evil', 'zh/admin', '/zh/legal/reconsent', '/fr/admin', '/zh/admin?x=1']) {
      expect(safeReturnPath(bad, 'zh')).toBeNull()
    }
    expect(safeReturnPath('/en/admin', 'zh')).toBeNull()
    expect(safeReturnPath(undefined, 'zh')).toBeNull()
  })
})
