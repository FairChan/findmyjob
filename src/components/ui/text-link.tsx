import * as React from 'react'
import { ChevronRight } from 'lucide-react'

import { Link } from '@/i18n/navigation'
import { cn } from '@/lib/utils'

type TextLinkProps = React.ComponentProps<typeof Link> & {
  /** Trailing chevron for links that move the visitor forward to another page. */
  chevron?: boolean
}

function TextLink({ className, chevron = true, children, ...props }: TextLinkProps) {
  return (
    <Link
      className={cn(
        'group inline-flex min-h-6 items-center gap-0.5 text-brand underline-offset-4 hover:underline',
        className,
      )}
      {...props}
    >
      {children}
      {chevron && (
        <ChevronRight
          aria-hidden="true"
          className="size-[1em] shrink-0 transition-transform group-hover:translate-x-0.5 motion-reduce:transition-none"
        />
      )}
    </Link>
  )
}

export { TextLink }
