'use client'

import { useEffect, useMemo, useState } from 'react'

const TYPE_MS = 120
const DELETE_MS = 65
const HOLD_MS = 1700
const GAP_MS = 320

interface HeroWordProps {
  /** Adjectives for the blank in the brand line; the first one is shown before any script runs. */
  words: string[]
}

type Phase = 'hold' | 'deleting' | 'typing'

/**
 * The blank in "Finding my ____ Job", filled in by a typewriter: a blinking caret types an
 * adjective, pauses, backspaces it and types the next. The slot keeps the width of the
 * longest word so the headline never reflows. Hovering holds the current word; visitors who
 * ask for reduced motion get the first word, still.
 * Purely visual: the parent supplies the full sentence to assistive tech.
 */
export function HeroWord({ words }: HeroWordProps) {
  // Split by code point so CJK and accented letters are typed whole.
  const glyphs = useMemo(() => words.map((word) => Array.from(word)), [words])
  const [index, setIndex] = useState(0)
  const [count, setCount] = useState(glyphs[0]?.length ?? 0)
  const [phase, setPhase] = useState<Phase>('hold')
  const [held, setHeld] = useState(false)
  const [animated, setAnimated] = useState(false)

  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)')
    const update = () => setAnimated(!media.matches)
    update()
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [])

  useEffect(() => {
    if (!animated || glyphs.length < 2) return
    const length = glyphs[index]?.length ?? 0
    let timer: number
    if (phase === 'hold') {
      if (held) return
      timer = window.setTimeout(() => setPhase('deleting'), HOLD_MS)
    } else if (phase === 'deleting') {
      timer =
        count > 0
          ? window.setTimeout(() => setCount((value) => value - 1), DELETE_MS)
          : window.setTimeout(() => {
              setIndex((value) => (value + 1) % glyphs.length)
              setPhase('typing')
            }, GAP_MS)
    } else {
      timer =
        count < length
          ? window.setTimeout(() => setCount((value) => value + 1), TYPE_MS)
          : window.setTimeout(() => setPhase('hold'), 0)
    }
    return () => window.clearTimeout(timer)
  }, [animated, glyphs, index, count, phase, held])

  const typed = (glyphs[index] ?? []).slice(0, count).join('')

  return (
    <span
      data-testid="hero-word"
      data-word={words[index]}
      data-typed={typed}
      onPointerEnter={() => setHeld(true)}
      onPointerLeave={() => setHeld(false)}
      className="relative mx-[0.18em] inline-grid px-[0.1em] text-left text-brand"
    >
      {/* Invisible copies of every word reserve the width of the longest one. */}
      {words.map((word) => (
        <span key={word} className="invisible col-start-1 row-start-1">
          {word}
        </span>
      ))}
      <span className="col-start-1 row-start-1 whitespace-nowrap">
        {typed}
        {animated && (
          <span className="animate-caret ml-[0.04em] inline-block h-[0.86em] w-[0.06em] translate-y-[0.08em] rounded-full bg-current" />
        )}
      </span>
      <span className="absolute inset-x-0 bottom-[-0.04em] h-[0.055em] rounded-full bg-current opacity-25" />
    </span>
  )
}
