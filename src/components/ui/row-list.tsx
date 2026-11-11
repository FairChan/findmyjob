import * as React from 'react'

import { cn } from '@/lib/utils'

/** Rows that share one card surface and are separated by hairlines, not boxes. */
function RowList({ className, ...props }: React.HTMLAttributes<HTMLUListElement>) {
  return (
    <ul className={cn('divide-y divide-foreground/10 overflow-hidden rounded-card bg-muted', className)} {...props} />
  )
}

function Row({ className, ...props }: React.LiHTMLAttributes<HTMLLIElement>) {
  return <li className={cn('flex items-center justify-between gap-4 px-5 py-4', className)} {...props} />
}

export { RowList, Row }
