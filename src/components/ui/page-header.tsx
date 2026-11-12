import type { ReactNode } from 'react'

import { cn } from '@/lib/utils'

interface PageHeaderProps {
  title: ReactNode
  lead?: ReactNode
  /** Short line above the title, e.g. the brand line for this page. */
  eyebrow?: ReactNode
  /** The page's primary action and at most one secondary link. */
  actions?: ReactNode
  className?: string
}

function PageHeader({ title, lead, eyebrow, actions, className }: PageHeaderProps) {
  return (
    <header className={cn('max-w-3xl', className)}>
      {eyebrow && <div className="mb-3">{eyebrow}</div>}
      <h1 className="text-headline text-balance">{title}</h1>
      {lead && <p className="mt-4 text-lead text-muted-foreground text-pretty">{lead}</p>}
      {actions && <div className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-3">{actions}</div>}
    </header>
  )
}

export { PageHeader }
