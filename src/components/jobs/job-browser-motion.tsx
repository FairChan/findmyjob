'use client'

import { createContext, useCallback, useContext, useEffect, useRef, type ReactNode } from 'react'
import { LayoutGroup, MotionConfig, motion, useReducedMotion } from 'motion/react'

interface JobOpener {
  element: HTMLAnchorElement
  href: string
  x: number
  y: number
}

const JobBrowserContext = createContext<{
  rememberOpener: (element: HTMLAnchorElement) => void
  restoreOpener: () => void
} | null>(null)

export function JobBrowserMotion({ children }: { children: ReactNode }) {
  const opener = useRef<JobOpener | null>(null)
  const rememberOpener = useCallback((element: HTMLAnchorElement) => {
    opener.current = { element, href: window.location.href, x: window.scrollX, y: window.scrollY }
  }, [])
  useEffect(() => {
    // The shared route also opens from application and recommendation links.
    // Capture before Next handles navigation, including keyboard-activated clicks.
    function rememberJobLink(event: MouseEvent) {
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
      const link = event.target instanceof Element ? event.target.closest('a') : null
      if (!(link instanceof HTMLAnchorElement) || link.hasAttribute('download') || (link.target && link.target !== '_self')) return
      const target = new URL(link.href)
      if (target.origin === window.location.origin && /^\/(?:zh|en)\/s\/jobs\/[^/]+\/?$/.test(target.pathname)) {
        rememberOpener(link)
      }
    }
    document.addEventListener('click', rememberJobLink, true)
    return () => document.removeEventListener('click', rememberJobLink, true)
  }, [rememberOpener])
  const restoreOpener = useCallback(() => {
    const previous = opener.current
    // Let the router finish restoring the retained background before moving focus.
    requestAnimationFrame(() => {
      if (!previous || window.location.href !== previous.href || !previous.element.isConnected) return
      previous.element.focus({ preventScroll: true })
      window.scrollTo({ left: previous.x, top: previous.y, behavior: 'instant' })
    })
  }, [])

  return (
    <JobBrowserContext.Provider value={{ rememberOpener, restoreOpener }}>
      <MotionConfig reducedMotion="user" transition={{ type: 'spring', stiffness: 340, damping: 34 }}>
        <LayoutGroup id="student-job-browser">{children}</LayoutGroup>
      </MotionConfig>
    </JobBrowserContext.Provider>
  )
}

export function useJobBrowserMotion() {
  return useContext(JobBrowserContext)
}

export function JobSharedTitle({ jobId, children }: { jobId: string; children: ReactNode }) {
  const browser = useJobBrowserMotion()
  const reducedMotion = useReducedMotion()
  return (
    <motion.span layoutId={browser && !reducedMotion ? `job-title-${jobId}` : undefined} className="block">
      {children}
    </motion.span>
  )
}
