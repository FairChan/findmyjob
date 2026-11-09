/**
 * Unit tests for AUDIT_ACTIONS constant.
 *
 * Purpose: If §5.7 of ARCHITECTURE.md changes (or someone edits AUDIT_ACTIONS),
 * this test fails immediately, forcing a human to reconcile the two sources.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { AUDIT_ACTIONS } from '@/server/lib/audit-actions'

// Extract the action list from ARCHITECTURE.md §5.7 by parsing the line after the section heading.
function parseArchitectureActions(): string[] {
  const archPath = join(process.cwd(), 'docs', 'ARCHITECTURE.md')
  const content = readFileSync(archPath, 'utf-8')

  // The section is a single line of backtick-delimited action names separated by 、
  const match = content.match(/### 5\.7 必须写审计日志的动作\n(.+)/)
  if (!match) throw new Error('Could not find §5.7 in ARCHITECTURE.md')

  const line = match[1]
  // Extract all backtick-quoted identifiers
  const actions = [...line.matchAll(/`([^`]+)`/g)].map((m) => m[1])
  if (actions.length === 0) throw new Error('No actions found in §5.7 line')
  return actions
}

describe('AUDIT_ACTIONS matches ARCHITECTURE §5.7', () => {
  it('every action in §5.7 is in AUDIT_ACTIONS', () => {
    const archActions = parseArchitectureActions()
    const codeSet = new Set<string>(AUDIT_ACTIONS)
    const missing = archActions.filter((a) => !codeSet.has(a))
    expect(missing, `Actions in §5.7 but missing from AUDIT_ACTIONS: ${missing.join(', ')}`).toEqual([])
  })

  it('every action in AUDIT_ACTIONS is in §5.7', () => {
    const archActions = parseArchitectureActions()
    const archSet = new Set(archActions)
    const extra = [...AUDIT_ACTIONS].filter((a) => !archSet.has(a))
    expect(extra, `Actions in AUDIT_ACTIONS but missing from §5.7: ${extra.join(', ')}`).toEqual([])
  })

  it('no duplicates in AUDIT_ACTIONS', () => {
    const seen = new Set<string>()
    const dupes = [...AUDIT_ACTIONS].filter((a) => {
      if (seen.has(a)) return true
      seen.add(a)
      return false
    })
    expect(dupes).toEqual([])
  })

  it('§5.7 has exactly 37 actions', () => {
    const archActions = parseArchitectureActions()
    expect(archActions).toHaveLength(37)
  })

  it('AUDIT_ACTIONS has exactly 37 entries', () => {
    expect(AUDIT_ACTIONS).toHaveLength(37)
  })

  it('includes content and synonym management actions', () => {
    expect(AUDIT_ACTIONS).toContain('article.save')
    expect(AUDIT_ACTIONS).toContain('search.synonym.save')
  })
})
