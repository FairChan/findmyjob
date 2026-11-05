import type { KeyboardEvent } from 'react'

/** Returns true if the event is part of an IME composition (CJK input). */
export function isImeComposing(e: KeyboardEvent): boolean {
  return e.nativeEvent.isComposing || e.keyCode === 229
}
