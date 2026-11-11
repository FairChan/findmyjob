import Image from 'next/image'
import { cn } from '@/lib/utils'

interface WordmarkProps {
  className?: string
  /** Drop the symbol where the name alone is enough, e.g. in running footer text. */
  symbol?: boolean
  /** On narrow screens show the symbol only; the name stays available to assistive tech. */
  collapse?: boolean
  /** Compact symbol sized to sit within the navigation bar. */
  prominent?: boolean
}

// "MY" carries both readings of the name: mine, and Malaysia's country code.
// It is set in italics and in the colours of the Malaysian flag.
export function Wordmark({
  className,
  symbol = true,
  collapse = false,
  prominent = false,
}: WordmarkProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-[0.4em] font-semibold tracking-tight',
        // Keep the symbol centered within the compact navigation bar.
        prominent && 'relative pl-[2.8em]',
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
              ? 'absolute left-0 top-1/2 h-[2.2em] max-w-none -translate-y-1/2 drop-shadow-[0_2px_4px_rgb(0_0_0/0.12)]'
              : 'h-[1.3em]',
          )}
        />
      )}
      <span className={collapse ? 'sr-only sm:not-sr-only' : undefined}>
        Find
        <span className="text-my-flag">
          <span>M</span>
          <span>Y</span>
        </span>
        Job
      </span>
    </span>
  )
}
