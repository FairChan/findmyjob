import { describe, it, expect } from 'vitest'
import { isImeComposing } from '@/lib/ime'
import type { KeyboardEvent } from 'react'

function makeKeyEvent(opts: {
  isComposing: boolean
  keyCode: number
  key: string
}): KeyboardEvent {
  return {
    nativeEvent: { isComposing: opts.isComposing },
    keyCode: opts.keyCode,
    key: opts.key,
    preventDefault: () => {},
  } as unknown as KeyboardEvent
}

describe('isImeComposing', () => {
  it('returns true when nativeEvent.isComposing is true', () => {
    const e = makeKeyEvent({ isComposing: true, keyCode: 229, key: 'Enter' })
    expect(isImeComposing(e)).toBe(true)
  })

  it('returns true when keyCode is 229 even if isComposing is false', () => {
    const e = makeKeyEvent({ isComposing: false, keyCode: 229, key: 'Enter' })
    expect(isImeComposing(e)).toBe(true)
  })

  it('returns false for a regular Enter key', () => {
    const e = makeKeyEvent({ isComposing: false, keyCode: 13, key: 'Enter' })
    expect(isImeComposing(e)).toBe(false)
  })

  it('returns false for a regular comma key', () => {
    const e = makeKeyEvent({ isComposing: false, keyCode: 188, key: ',' })
    expect(isImeComposing(e)).toBe(false)
  })
})

// Simulate the skill input logic from ProfileEditor
function handleSkillKeyDown(
  e: KeyboardEvent,
  skillInput: string,
  skills: string[],
): string[] {
  if (isImeComposing(e)) return skills
  if (e.key !== 'Enter' && e.key !== ',') return skills
  const val = skillInput.trim()
  if (val && !skills.includes(val) && skills.length < 30) {
    return [...skills, val]
  }
  return skills
}

describe('skill tag input logic', () => {
  it('does not add a skill when Enter is dispatched with isComposing=true', () => {
    const e = makeKeyEvent({ isComposing: true, keyCode: 229, key: 'Enter' })
    const result = handleSkillKeyDown(e, 'python', ['react'])
    expect(result).toHaveLength(1)
    expect(result).toEqual(['react'])
  })

  it('does not add a skill when keyCode=229', () => {
    const e = makeKeyEvent({ isComposing: false, keyCode: 229, key: 'Enter' })
    const result = handleSkillKeyDown(e, 'python', ['react'])
    expect(result).toHaveLength(1)
  })

  it('adds a skill when Enter is dispatched normally', () => {
    const e = makeKeyEvent({ isComposing: false, keyCode: 13, key: 'Enter' })
    const result = handleSkillKeyDown(e, 'python', ['react'])
    expect(result).toHaveLength(2)
    expect(result).toContain('python')
  })

  it('deduplicates: does not add an existing skill', () => {
    const e = makeKeyEvent({ isComposing: false, keyCode: 13, key: 'Enter' })
    const result = handleSkillKeyDown(e, 'react', ['react'])
    expect(result).toHaveLength(1)
  })

  it('enforces 30-skill maximum', () => {
    const e = makeKeyEvent({ isComposing: false, keyCode: 13, key: 'Enter' })
    const full = Array.from({ length: 30 }, (_, i) => `skill${i}`)
    const result = handleSkillKeyDown(e, 'newskill', full)
    expect(result).toHaveLength(30)
  })

  it('adds a skill when comma is pressed normally', () => {
    const e = makeKeyEvent({ isComposing: false, keyCode: 188, key: ',' })
    const result = handleSkillKeyDown(e, 'vue', [])
    expect(result).toEqual(['vue'])
  })
})
