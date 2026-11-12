import * as React from 'react'

import { cn } from '@/lib/utils'

interface SectionProps extends React.HTMLAttributes<HTMLElement> {
  /** Sections alternate between the two page surfaces instead of using divider lines. */
  tone?: 'plain' | 'muted'
  /** `compact` is for supporting strips such as notices; `default` is a full content section. */
  spacing?: 'default' | 'compact'
}

function Section({ tone = 'plain', spacing = 'default', className, children, ...props }: SectionProps) {
  return (
    <section
      className={cn(
        tone === 'muted' ? 'bg-muted' : 'bg-background',
        spacing === 'compact' ? 'py-10' : 'py-16 md:py-24',
        className,
      )}
      {...props}
    >
      <div className="page-shell">{children}</div>
    </section>
  )
}

interface SectionHeaderProps {
  title: React.ReactNode
  lead?: React.ReactNode
  /** A single link or button aligned with the title, e.g. "View all". */
  action?: React.ReactNode
  align?: 'start' | 'center'
  id?: string
  className?: string
}

function SectionHeader({ title, lead, action, align = 'start', id, className }: SectionHeaderProps) {
  return (
    <div
      className={cn(
        'mb-8 flex flex-col gap-3 md:mb-12',
        align === 'center'
          ? 'items-center text-center'
          : 'sm:flex-row sm:items-end sm:justify-between',
        className,
      )}
    >
      <div className={cn('max-w-2xl', align === 'center' && 'mx-auto')}>
        <h2 id={id} className="text-headline text-balance">
          {title}
        </h2>
        {lead && <p className="mt-3 text-lead text-muted-foreground text-pretty">{lead}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  )
}

export { Section, SectionHeader }
