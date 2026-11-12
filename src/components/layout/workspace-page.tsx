import type { ReactNode } from 'react'

import { cn } from '@/lib/utils'

// Forms read best narrow; lists and dashboards get more room; boards and the
// talent search, with a filter column beside the results, take the most.
const WIDTHS = {
  narrow: 'max-w-md',
  form: 'max-w-2xl',
  list: 'max-w-3xl',
  wide: 'max-w-4xl',
  board: 'max-w-6xl',
  full: 'max-w-7xl',
} as const

interface WorkspacePageProps {
  title: ReactNode
  lead?: ReactNode
  /** A line above the title, typically the way back to the parent page. */
  eyebrow?: ReactNode
  /** The page-level action, shown beside the title; sits below it on narrow screens. */
  actions?: ReactNode
  width?: keyof typeof WIDTHS
  children: ReactNode
}

/**
 * Frame for a page inside the signed-in workspaces: one column, one large title,
 * and the same rhythm between blocks on every page.
 */
export function WorkspacePage({ title, lead, eyebrow, actions, width = 'form', children }: WorkspacePageProps) {
  return (
    <div className={cn('mx-auto w-full px-4 pb-20 pt-8 sm:px-6 md:pt-12', WIDTHS[width])}>
      {eyebrow && <div className="mb-4">{eyebrow}</div>}
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between sm:gap-6">
        <div className="min-w-0 flex-1">
          <h1 className="text-headline text-balance [overflow-wrap:anywhere]">{title}</h1>
          {lead && <p className="mt-3 text-body text-muted-foreground text-pretty">{lead}</p>}
        </div>
        {actions && <div className="shrink-0">{actions}</div>}
      </header>
      <div className="mt-8 space-y-8 md:mt-10">{children}</div>
    </div>
  )
}

/** Quiet "back to …" link for the eyebrow slot. */
export const BACK_LINK_CLASS =
  'inline-flex min-h-6 items-center gap-1 text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline'
