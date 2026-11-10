import Image from 'next/image'
import { cn } from '@/lib/utils'

interface WordmarkProps {
  className?: string
  /** Drop the symbol where the name alone is enough, e.g. in running footer text. */
  symbol?: boolean
  /** On narrow screens show the symbol only; the name stays available to assistive tech. */
  collapse?: boolean
}

// "MY" carries both readings of the name: mine, and Malaysia's country code.
// It is the only place the accent colour is used decoratively.
export function Wordmark({ className, symbol = true, collapse = false }: WordmarkProps) {
  return (
    <span className={cn('inline-flex items-center gap-[0.4em] font-semibold tracking-tight', className)}>
      {symbol && (
        <Image
          src="/images/brand/findmyjob-mark.svg"
          alt=""
          aria-hidden="true"
          width={440}
          height={408}
          unoptimized
          className="h-[1.3em] w-auto shrink-0"
        />
      )}
      <span className={collapse ? 'sr-only sm:not-sr-only' : undefined}>
        Find<span className="text-brand">MY</span>Job
      </span>
    </span>
  )
}
