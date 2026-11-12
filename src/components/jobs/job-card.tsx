'use client'

import { motion, useReducedMotion } from 'motion/react'
import { Link } from '@/i18n/navigation'
import { Badge, type BadgeProps } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import { JobSharedTitle, useJobBrowserMotion } from './job-browser-motion'

export interface JobCardBadge {
  label: string
  tone?: BadgeProps['tone']
}

interface JobCardProps {
  jobId: string
  href?: string
  title: string
  company: string
  badges: JobCardBadge[]
  /** Already formatted; omit when the employer hides the salary. */
  salary?: string | null
  /** `tile` for grids, `row` for a scannable list. */
  layout?: 'tile' | 'row'
  /** Heading level of the title within the page outline. */
  as?: 'h2' | 'h3' | 'p'
}

export function JobCard({ jobId, href, title, company, badges, salary, layout = 'tile', as: Title = 'h3' }: JobCardProps) {
  const row = layout === 'row'
  const browser = useJobBrowserMotion()
  const reducedMotion = useReducedMotion()
  const memberJob = href?.startsWith('/s/jobs/') ?? false
  return (
    // Opening a job detail spends the student's view quota, so never prefetch it.
    <Link
      href={href ?? `/jobs/${jobId}`}
      prefetch={false}
      scroll={memberJob ? false : undefined}
      onClick={(event) => {
        if (memberJob && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey && event.button === 0) {
          browser?.rememberOpener(event.currentTarget)
        }
      }}
      className="group block h-full rounded-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
    >
      <motion.div layoutId={memberJob && !reducedMotion ? `job-card-${jobId}` : undefined} className="h-full rounded-card">
        <Card
          className={cn(
            'flex h-full transition-[background-color,box-shadow] group-hover:bg-card group-hover:shadow-float group-hover:ring-1 group-hover:ring-brand/30 motion-reduce:transition-none',
            row ? 'flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-6' : 'flex-col',
          )}
        >
          <div className="min-w-0">
            <p className="text-xs text-muted-foreground">{company}</p>
            <Title className={cn('mt-1.5 break-words text-body font-semibold leading-snug', row ? 'sm:truncate' : 'line-clamp-2')}>
              {memberJob ? <JobSharedTitle jobId={jobId}>{title}</JobSharedTitle> : title}
            </Title>
            {badges.length > 0 && (
              <div className={cn('flex flex-wrap gap-1.5', row ? 'mt-3' : 'mt-4')}>
                {badges.map((badge) => (
                  <Badge key={badge.label} tone={badge.tone ?? 'plain'}>
                    {badge.label}
                  </Badge>
                ))}
              </div>
            )}
          </div>
          {salary && (
            <p className={cn('text-sm font-medium', row ? 'shrink-0 sm:text-right' : 'mt-auto pt-5')}>{salary}</p>
          )}
        </Card>
      </motion.div>
    </Link>
  )
}
