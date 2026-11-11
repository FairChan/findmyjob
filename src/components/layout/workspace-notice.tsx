import Link from 'next/link'
import type { ReactNode } from 'react'

import { Button } from '@/components/ui/button'

interface WorkspaceNoticeProps {
  title: ReactNode
  description: ReactNode
  /** Where the visitor can go next; omit when there is nothing they can do. */
  action?: { label: ReactNode; href: string; variant?: 'brand' | 'outline' }
  tone?: 'warning' | 'neutral'
}

/**
 * A whole page that only says why its content is unavailable (company not yet
 * verified, daily view limit reached) and where to go instead.
 */
export function WorkspaceNotice({ title, description, action, tone = 'warning' }: WorkspaceNoticeProps) {
  const warning = tone === 'warning'
  return (
    <div className="mx-auto w-full max-w-2xl px-4 pb-20 pt-8 sm:px-6 md:pt-12">
      <div
        role="alert"
        className={warning ? 'rounded-card bg-warning-muted p-8 text-center sm:p-10' : 'rounded-card bg-muted p-8 text-center sm:p-10'}
      >
        <h1 className={warning ? 'text-title text-warning' : 'text-title'}>{title}</h1>
        <p className={warning ? 'mt-2 text-sm text-warning' : 'mt-2 text-sm text-muted-foreground'}>{description}</p>
        {action && (
          <Button asChild variant={action.variant ?? 'brand'} className="mt-6">
            <Link href={action.href} prefetch={false}>
              {action.label}
            </Link>
          </Button>
        )}
      </div>
    </div>
  )
}
