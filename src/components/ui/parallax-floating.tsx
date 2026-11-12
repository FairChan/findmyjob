'use client'

import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
} from 'react'
import { useAnimationFrame } from 'motion/react'

import { cn } from '@/lib/utils'
import { useMousePositionRef } from '@/hooks/use-mouse-position-ref'

/**
 * Elements that drift with the pointer, each by an amount set by its depth.
 * From the "parallax-floating" block by danielpetho, with two changes: offsets are measured
 * from the container's centre (so the resting layout is the designed one), and nothing moves
 * for visitors who ask the OS for reduced motion.
 */

interface FloatingContextType {
  registerElement: (id: string, element: HTMLDivElement, depth: number) => void
  unregisterElement: (id: string) => void
}

const FloatingContext = createContext<FloatingContextType | null>(null)

interface FloatingProps {
  children: ReactNode
  className?: string
  /** Multiplier on every element's travel; negative moves them away from the pointer. */
  sensitivity?: number
  /** Share of the remaining distance covered each frame; lower is smoother. */
  easingFactor?: number
}

const Floating = ({ children, className, sensitivity = 1, easingFactor = 0.05 }: FloatingProps) => {
  const containerRef = useRef<HTMLDivElement>(null)
  const elementsMap = useRef(
    new Map<string, { element: HTMLDivElement; depth: number; currentPosition: { x: number; y: number } }>(),
  )
  const mousePositionRef = useMousePositionRef(containerRef)
  const moved = useRef(false)
  const reduced = useRef(false)

  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)')
    const update = () => {
      reduced.current = media.matches
    }
    update()
    const onMove = () => {
      moved.current = true
    }
    media.addEventListener('change', update)
    window.addEventListener('mousemove', onMove, { once: true })
    return () => {
      media.removeEventListener('change', update)
      window.removeEventListener('mousemove', onMove)
    }
  }, [])

  const registerElement = useCallback((id: string, element: HTMLDivElement, depth: number) => {
    elementsMap.current.set(id, { element, depth, currentPosition: { x: 0, y: 0 } })
  }, [])

  const unregisterElement = useCallback((id: string) => {
    elementsMap.current.delete(id)
  }, [])

  useAnimationFrame(() => {
    const container = containerRef.current
    // Until the pointer first moves there is no position to follow.
    if (!container || reduced.current || !moved.current) return
    const centreX = container.clientWidth / 2
    const centreY = container.clientHeight / 2

    elementsMap.current.forEach((data) => {
      const strength = (data.depth * sensitivity) / 20
      const targetX = (mousePositionRef.current.x - centreX) * strength
      const targetY = (mousePositionRef.current.y - centreY) * strength
      data.currentPosition.x += (targetX - data.currentPosition.x) * easingFactor
      data.currentPosition.y += (targetY - data.currentPosition.y) * easingFactor
      data.element.style.transform = `translate3d(${data.currentPosition.x}px, ${data.currentPosition.y}px, 0)`
    })
  })

  const value = useMemo(() => ({ registerElement, unregisterElement }), [registerElement, unregisterElement])

  return (
    <FloatingContext.Provider value={value}>
      <div ref={containerRef} className={cn('absolute left-0 top-0 h-full w-full', className)}>
        {children}
      </div>
    </FloatingContext.Provider>
  )
}

export default Floating

interface FloatingElementProps {
  children: ReactNode
  className?: string
  /** How far this element travels relative to the others. */
  depth?: number
}

let nextId = 0

export const FloatingElement = ({ children, className, depth = 1 }: FloatingElementProps) => {
  const elementRef = useRef<HTMLDivElement>(null)
  const idRef = useRef<string | null>(null)
  const context = useContext(FloatingContext)

  useEffect(() => {
    if (!elementRef.current || !context) return
    idRef.current ??= `floating-${nextId++}`
    const id = idRef.current
    context.registerElement(id, elementRef.current, depth)
    return () => context.unregisterElement(id)
  }, [context, depth])

  return (
    <div ref={elementRef} className={cn('absolute will-change-transform', className)}>
      {children}
    </div>
  )
}
