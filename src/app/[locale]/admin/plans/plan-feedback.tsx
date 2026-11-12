'use client'

import { createContext, useContext, useRef, useState, useTransition, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'

const PlanFeedbackContext = createContext<{
  announce: (message: string) => void
  focusHeading: () => void
  refresh: () => void
  refreshing: boolean
} | null>(null)

export function PlanFeedback({ title, description, actions, children }: {
  title: string
  description: string
  actions: ReactNode
  children: ReactNode
}) {
  const heading = useRef<HTMLHeadingElement>(null)
  const router = useRouter()
  const [refreshing, startTransition] = useTransition()
  const [notice, setNotice] = useState({ message: '', sequence: 0 })

  return (
    <PlanFeedbackContext.Provider value={{
      announce: (message) => setNotice((current) => ({ message, sequence: current.sequence + 1 })),
      focusHeading: () => { requestAnimationFrame(() => heading.current?.focus()) },
      refresh: () => startTransition(() => router.refresh()),
      refreshing,
    }}>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <h1 ref={heading} data-testid="plan-heading" tabIndex={-1} className="text-2xl font-semibold focus-visible:outline-2 focus-visible:outline-brand">{title}</h1>
          <p className="mt-2 text-sm text-muted-foreground">{description}</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">{actions}</div>
      </div>
      <p data-testid="plan-feedback" role="status" aria-atomic="true" className="text-sm text-success">
        <span key={notice.sequence}>{notice.message}</span>
      </p>
      {children}
    </PlanFeedbackContext.Provider>
  )
}

export function usePlanFeedback() {
  const context = useContext(PlanFeedbackContext)
  if (!context) throw new Error('Plan controls require PlanFeedback')
  return context
}
