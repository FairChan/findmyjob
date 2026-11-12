'use client'
import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { stateLabel } from '@/lib/my-states'
import type { JobListItem } from '@/server/serializers/job'
import type { TalentCard } from '@/server/serializers/talent-card'

// Shared by the student panel (muted surface) and the employer panel (white surface),
// so the cards keep a hairline to stay distinct on both.
const cardClass = 'min-w-0 rounded-control border bg-background p-4 [overflow-wrap:anywhere]'
const linkClass = 'inline-flex min-h-11 items-center font-semibold text-foreground underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-ring'

export function MatchingJobCards({ items, locale }: { items: JobListItem[]; locale: string }) {
  const t = useTranslations('publicJobs')
  return <ul className="space-y-3" data-testid="matching-job-results">{items.map(job => <li key={job.id} className={cardClass}>
    <h3><Link href={'/' + locale + '/s/jobs/' + job.id} prefetch={false} className={linkClass}>{job.title}</Link></h3>
    <p className="text-sm text-muted-foreground">{locale === 'zh' ? job.company.displayNameZh ?? job.company.legalName : job.company.displayNameEn ?? job.company.legalName}</p>
    <p className="mt-1 text-sm">{t(`type.${job.type}`)}{job.state ? ' · ' + stateLabel(job.state, locale) : ''}{job.city ? ' · ' + job.city : ''}</p>
    {job.skills.length > 0 && <p className="mt-2 text-sm text-muted-foreground">{job.skills.slice(0, 5).join(' · ')}</p>}
  </li>)}</ul>
}

export function MatchingTalentCards({ items, locale }: { items: TalentCard[]; locale: string }) {
  return <ul className="space-y-3" data-testid="matching-talent-results">{items.map(card => <li key={card.id} className={cardClass}>
    <h3><Link href={'/' + locale + '/e/talent/' + card.id} prefetch={false} className={linkClass}>{card.name}</Link></h3>
    {card.headline && <p className="text-sm whitespace-pre-wrap">{card.headline}</p>}
    {(card.school || card.major) && <p className="mt-1 text-sm text-muted-foreground">{[
      card.school ? locale === 'zh' ? card.school.nameZh : card.school.nameEn : null, card.major,
    ].filter(Boolean).join(' · ')}</p>}
    {card.skills.length > 0 && <p className="mt-2 text-sm text-muted-foreground">{card.skills.slice(0, 5).join(' · ')}</p>}
  </li>)}</ul>
}
