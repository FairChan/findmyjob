/**
 * M2-T11 fix 3: shared tag-input helper (IME-aware tag entry)
 */
import { describe, it, expect, vi } from 'vitest'
import type { KeyboardEvent } from 'react'

vi.mock('@/env', () => ({ env: {} }))

import { handleTagKeyDown } from '@/lib/tag-input'

function makeEvent(key: string, isComposing = false): KeyboardEvent<HTMLInputElement> {
  return {
    key,
    nativeEvent: { isComposing },
    preventDefault: vi.fn(),
  } as unknown as KeyboardEvent<HTMLInputElement>
}

describe('handleTagKeyDown', () => {
  it('adds tag on Enter', () => {
    const onAdd = vi.fn()
    const onClear = vi.fn()
    handleTagKeyDown(makeEvent('Enter'), 'React', [], 30, onAdd, onClear)
    expect(onAdd).toHaveBeenCalledWith('React')
    expect(onClear).toHaveBeenCalled()
  })

  it('adds tag on comma', () => {
    const onAdd = vi.fn()
    const onClear = vi.fn()
    handleTagKeyDown(makeEvent(','), 'Vue', [], 30, onAdd, onClear)
    expect(onAdd).toHaveBeenCalledWith('Vue')
    expect(onClear).toHaveBeenCalled()
  })

  it('does NOT add tag when composing (IME)', () => {
    const onAdd = vi.fn()
    const onClear = vi.fn()
    handleTagKeyDown(makeEvent('Enter', true), 'React', [], 30, onAdd, onClear)
    expect(onAdd).not.toHaveBeenCalled()
    expect(onClear).not.toHaveBeenCalled()
  })

  it('does not add duplicate', () => {
    const onAdd = vi.fn()
    const onClear = vi.fn()
    handleTagKeyDown(makeEvent('Enter'), 'React', ['React'], 30, onAdd, onClear)
    expect(onAdd).not.toHaveBeenCalled()
    expect(onClear).toHaveBeenCalled()
  })

  it('does not add when at max', () => {
    const onAdd = vi.fn()
    const onClear = vi.fn()
    const tags = Array.from({ length: 30 }, (_, i) => `skill${i}`)
    handleTagKeyDown(makeEvent('Enter'), 'Extra', tags, 30, onAdd, onClear)
    expect(onAdd).not.toHaveBeenCalled()
    expect(onClear).toHaveBeenCalled()
  })

  it('does not fire on other keys', () => {
    const onAdd = vi.fn()
    const onClear = vi.fn()
    handleTagKeyDown(makeEvent('a'), 'React', [], 30, onAdd, onClear)
    expect(onAdd).not.toHaveBeenCalled()
    expect(onClear).not.toHaveBeenCalled()
  })

  it('trims whitespace from value', () => {
    const onAdd = vi.fn()
    const onClear = vi.fn()
    handleTagKeyDown(makeEvent('Enter'), '  TypeScript  ', [], 30, onAdd, onClear)
    expect(onAdd).toHaveBeenCalledWith('TypeScript')
  })

  it('does not add empty string after trim', () => {
    const onAdd = vi.fn()
    const onClear = vi.fn()
    handleTagKeyDown(makeEvent('Enter'), '   ', [], 30, onAdd, onClear)
    expect(onAdd).not.toHaveBeenCalled()
    expect(onClear).toHaveBeenCalled()
  })

  it('IME guard uses keyCode 229 fallback', () => {
    const onAdd = vi.fn()
    const onClear = vi.fn()
    // keyCode 229 is the IME composing sentinel on older browsers
    const e = { key: 'Enter', nativeEvent: { isComposing: false }, keyCode: 229, preventDefault: vi.fn() } as unknown as KeyboardEvent<HTMLInputElement>
    handleTagKeyDown(e, 'React', [], 30, onAdd, onClear)
    expect(onAdd).not.toHaveBeenCalled()
  })
})
