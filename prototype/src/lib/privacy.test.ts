import { describe, it, expect } from 'vitest'
import { completeness, firstIncompleteStep } from './privacy'
import { emptyStudent, fullStudent } from '../test/fixtures'

describe('completeness', () => {
  it('empty profile scores 0', () => expect(completeness(emptyStudent()).score).toBe(0))
  it('everything but PDF scores 90', () => expect(completeness(fullStudent({ hasResume: false })).score).toBe(90))
  it('full profile scores 100', () => expect(completeness(fullStudent({ hasResume: true })).score).toBe(100))
})

describe('firstIncompleteStep', () => {
  it('walks the wizard in order', () => {
    expect(firstIncompleteStep(emptyStudent())).toBe(1)
    expect(firstIncompleteStep(fullStudent({ intents: [] }))).toBe(2)
    expect(firstIncompleteStep(fullStudent({ skills: ['a'] }))).toBe(3)
    expect(firstIncompleteStep(fullStudent({ education: [] }))).toBe(4)
    expect(firstIncompleteStep(fullStudent())).toBeNull()
  })
})
