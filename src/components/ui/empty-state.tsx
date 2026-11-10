import * as React from 'react'

import { cn } from '@/lib/utils'

interface EmptyStateProps {
  title: React.ReactNode
  description?: React.ReactNode
  /** The next thing the visitor can do from here. */
  action?: React.ReactNode
  icon?: React.ReactNode
  className?: string
}

function EmptyState({ title, description, action, icon, className }: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center rounded-card bg-muted px-6 py-12 text-center',
        className,
      )}
    >
      {icon && (
        <div aria-hidden="true" className="mb-4 text-muted-foreground [&_svg]:size-7">
          {icon}
        </div>
      )}
      <p className="text-title">{title}</p>
      {description && (
        <p className="mt-2 max-w-md text-sm text-muted-foreground text-pretty">{description}</p>
      )}
      {action && <div className="mt-6">{action}</div>}
    </div>
  )
}

export { EmptyState }
