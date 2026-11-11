'use client'

import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react'

interface FeedbackContext {
  announce: (message: string) => void
  focusFeedback: () => void
}
const Context = createContext<FeedbackContext | null>(null)

/** Keep feedback outside list rows that disappear after a successful action. */
export function AdminActionFeedback({ children }: { children: ReactNode }) {
  const statusRef = useRef<HTMLParagraphElement>(null)
  const [feedback, setFeedback] = useState({ message: '', sequence: 0 })
  const announce = useCallback((message: string) => {
    setFeedback((previous) => ({ message, sequence: previous.sequence + 1 }))
  }, [])
  // Called by Dialog.onCloseAutoFocus, after the modal focus scope releases.
  const focusFeedback = useCallback(() => {
    statusRef.current?.focus()
  }, [])
  const value = useMemo(() => ({ announce, focusFeedback }), [announce, focusFeedback])

  return (
    <Context.Provider value={value}>
      <p
        ref={statusRef}
        role="status"
        aria-live="polite"
        aria-atomic="true"
        tabIndex={-1}
        className={feedback.message
          ? 'rounded-card border border-success/30 bg-success-muted p-4 text-sm text-success focus:outline-2 focus:outline-offset-2 focus:outline-success'
          : 'sr-only'}
      >
        <span key={feedback.sequence}>{feedback.message}</span>
      </p>
      {children}
    </Context.Provider>
  )
}

export function useAdminActionFeedback(): FeedbackContext {
  const context = useContext(Context)
  if (!context) throw new Error('Admin actions require a page feedback provider')
  return context
}

