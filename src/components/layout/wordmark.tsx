import { cn } from '@/lib/utils'

// "MY" carries both readings of the name: mine, and Malaysia's country code.
// It is the only place the accent colour is used decoratively.
export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cn('font-semibold tracking-tight', className)}>
      Find<span className="text-brand">MY</span>Job
    </span>
  )
}
