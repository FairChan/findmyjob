'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

const STEP_MS = 1150

interface HeroWordProps {
  /** Adjectives for the blank in the brand line; the first one is the resting word. */
  words: string[]
}

/**
 * The blank in "Finding my ____ Job": a fixed-width slot that rolls through the
 * adjectives once, then rests on the first. One pass stays under five seconds, so it
 * needs no pause control; hovering the slot plays it again.
 * Purely visual: the parent supplies the full sentence to assistive tech.
 */
export function HeroWord({ words }: HeroWordProps) {
  const [index, setIndex] = useState(0)
  const [previous, setPrevious] = useState(-1)
  const timer = useRef(0)
  const playing = useRef(false)

  const play = useCallback(() => {
    if (playing.current || words.length < 2) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    playing.current = true
    let step = 0
    const advance = () => {
      step += 1
      const next = step % words.length
      setPrevious((next - 1 + words.length) % words.length)
      setIndex(next)
      if (next === 0) {
        playing.current = false
        return
      }
      timer.current = window.setTimeout(advance, STEP_MS)
    }
    timer.current = window.setTimeout(advance, STEP_MS)
  }, [words.length])

  useEffect(() => {
    play()
    return () => {
      window.clearTimeout(timer.current)
      playing.current = false
    }
  }, [play])

  return (
    <span
      data-testid="hero-word"
      data-word={words[index]}
      onPointerEnter={play}
      className="relative mx-[0.18em] inline-grid justify-items-center px-[0.12em] text-brand"
    >
      {words.map((word, i) => (
        <span
          key={word}
          className={`col-start-1 row-start-1 transition-[opacity,transform] duration-500 ease-out motion-reduce:transition-none ${
            i === index
              ? 'translate-y-0 opacity-100'
              : i === previous
                ? '-translate-y-[0.4em] opacity-0'
                : 'translate-y-[0.4em] opacity-0'
          }`}
        >
          {word}
        </span>
      ))}
      <span className="absolute inset-x-0 bottom-[-0.04em] h-[0.055em] rounded-full bg-current opacity-25" />
    </span>
  )
}
