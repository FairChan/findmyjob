import { Link } from '@/i18n/navigation'
import { Badge, type BadgeProps } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import { cn } from '@/lib/utils'

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
  return (
    // Opening a job detail spends the student's view quota, so never prefetch it.
    <Link href={href ?? `/jobs/${jobId}`} prefetch={false} className="group block h-full rounded-card">
      <Card
        className={cn(
          'flex h-full transition-[background-color,box-shadow] group-hover:bg-card group-hover:shadow-float motion-reduce:transition-none',
          row ? 'flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-6' : 'flex-col',
        )}
      >
        <div className="min-w-0">
          <p className="text-xs text-muted-foreground">{company}</p>
          <Title className={cn('mt-1.5 text-body font-semibold leading-snug', row ? 'sm:truncate' : 'line-clamp-2')}>
            {title}
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
    </Link>
  )
}
