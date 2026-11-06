import type { KeyboardEvent } from 'react'
import { isImeComposing } from './ime'

/**
 * Shared keydown handler for tag/chip inputs.
 * Adds a tag on Enter or comma, skipping IME composition events.
 */
export function handleTagKeyDown(
  e: KeyboardEvent<HTMLInputElement>,
  value: string,
  tags: string[],
  maxTags: number,
  onAdd: (tag: string) => void,
  onClearInput: () => void,
): void {
  if (isImeComposing(e as unknown as React.KeyboardEvent)) return
  if (e.key !== 'Enter' && e.key !== ',') return
  e.preventDefault()
  const val = value.trim()
  if (val && !tags.includes(val) && tags.length < maxTags) {
    onAdd(val)
  }
  onClearInput()
}
