import Image from 'next/image'
import { cn } from '@/lib/utils'

interface WordmarkProps {
  className?: string
  /** Drop the symbol where the name alone is enough, e.g. in running footer text. */
  symbol?: boolean
  /** On narrow screens show the symbol only; the name stays available to assistive tech. */
  collapse?: boolean
  /** Oversized symbol that breaks out of the bar it sits in, for contrast with a slim nav. */
  prominent?: boolean
}

// "MY" carries both readings of the name: mine, and Malaysia's country code.
// It is set in italics and in the colours of the Malaysian flag.
export function Wordmark({ className, symbol = true, collapse = false, prominent = false }: WordmarkProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-[0.4em] font-semibold tracking-tight',
        // Room for the oversized symbol, which is taken out of the flow so the bar keeps its height.
        prominent && 'relative pl-[4.15em]',
        className,
      )}
    >
      {symbol && (
        <Image
          src="/images/brand/findmyjob-mark.svg"
          alt=""
          aria-hidden="true"
          width={440}
          height={408}
          unoptimized
          className={cn(
            'w-auto shrink-0',
            prominent
              ? 'absolute left-0 top-1/2 h-[3.5em] max-w-none -translate-y-1/2 drop-shadow-[0_6px_10px_rgb(0_0_0/0.18)]'
              : 'h-[1.3em]',
          )}
        />
      )}
      <span className={collapse ? 'sr-only sm:not-sr-only' : undefined}>
        Find<span className="text-my-flag">MY</span>Job
      </span>
    </span>
  )
}
