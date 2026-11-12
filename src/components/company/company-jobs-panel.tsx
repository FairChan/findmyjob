import { ArrowUpRight, MapPin } from 'lucide-react'
import { getTranslations } from 'next-intl/server'
import { Link } from '@/i18n/navigation'
import { safeWebsiteHref } from '@/lib/url-utils'
import { JobCard } from '@/components/jobs/job-card'
import { EmptyState } from '@/components/ui/empty-state'
import { Button } from '@/components/ui/button'
import { stateLabel } from '@/lib/my-states'
import type { getPublicCompany } from '@/server/services/company'
import type { CompanyBrowseJob } from '@/server/services/company-browse'

interface CompanyJobsPanelProps {
  company: Awaited<ReturnType<typeof getPublicCompany>>
  jobs: CompanyBrowseJob[]
  locale: string
  missing: boolean
  nextHref: string | null
  firstHref: string | null
}

export async function CompanyJobsPanel({ company, jobs, locale, missing, nextHref, firstHref }: CompanyJobsPanelProps) {
  const t = await getTranslations('companyBrowser')
  const jobLabels = await getTranslations('publicJobs')
  if (!company) return (
    <div className="p-6">
      <h2 data-company-panel-heading tabIndex={-1} className="text-title outline-none">{t(missing ? 'missingTitle' : 'chooseTitle')}</h2>
      <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{t(missing ? 'missingDescription' : 'chooseDescription')}</p>
    </div>
  )

  const name = locale === 'zh' ? company.displayNameZh ?? company.legalName : company.displayNameEn ?? company.legalName
  const location = [company.city, stateLabel(company.state, locale)].filter(Boolean).join(', ')
  const website = safeWebsiteHref(company.website)

  return (
    <div className="p-5 sm:p-6">
      <p className="text-xs font-medium uppercase tracking-wider text-brand">{t('selectedCompany')}</p>
      <header className="mt-4 flex items-start gap-4">
        {company.logoKey ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={`/api/logos/${company.id}`} alt="" className="size-14 shrink-0 rounded-control bg-muted object-contain" />
        ) : <span aria-hidden="true" className="flex size-14 shrink-0 items-center justify-center rounded-control bg-muted text-xl font-semibold text-muted-foreground">{name.charAt(0)}</span>}
        <div className="min-w-0">
          <h2 data-company-panel-heading tabIndex={-1} className="break-words text-title outline-none focus-visible:rounded-sm focus-visible:ring-2 focus-visible:ring-ring">{name}</h2>
          {location && <p className="mt-2 flex items-start gap-1 text-sm text-muted-foreground"><MapPin className="mt-0.5 size-4 shrink-0" aria-hidden="true" /><span className="break-words">{location}</span></p>}
        </div>
      </header>
      {website && <a href={website} target="_blank" rel="noopener noreferrer" className="mt-3 inline-flex min-h-11 max-w-full items-center gap-1 rounded-sm text-sm font-medium text-brand underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><span className="truncate">{new URL(website).hostname}</span><ArrowUpRight className="size-4 shrink-0" aria-hidden="true" /><span className="sr-only">{t('website')}</span></a>}
      <p className="mt-4 whitespace-pre-wrap break-words text-sm leading-relaxed text-muted-foreground">{company.description || t('noDescription')}</p>
      <section className="mt-6 border-t pt-6" aria-labelledby="company-open-jobs">
        <p id="company-open-jobs" className="text-base font-semibold">{t('openJobs')}</p>
        {jobs.length === 0 ? <EmptyState className="mt-4" title={t('noJobs')} /> : (
          <ul className="mt-4 grid gap-3">
            {jobs.map(job => {
              const location = [job.city, stateLabel(job.state, locale)].filter(Boolean).join(', ')
              const salary = job.salaryMin !== null && job.salaryMax !== null
                ? `MYR ${job.salaryMin.toLocaleString()} – ${job.salaryMax.toLocaleString()}`
                : job.salaryMin !== null ? `MYR ${job.salaryMin.toLocaleString()}+`
                  : job.salaryMax !== null ? `≤ MYR ${job.salaryMax.toLocaleString()}` : null
              return <li key={job.id}><JobCard
                jobId={job.id} href={`/s/jobs/${job.id}`} title={job.title} company={name} salary={salary} as="h3"
                badges={[
                  { label: jobLabels(`type.${job.type}`) },
                  { label: jobLabels(`workMode.${job.workMode}`) },
                  ...(location ? [{ label: location }] : []),
                  ...(job.acceptsStudentPass ? [{ label: jobLabels('facts.studentPass'), tone: 'success' as const }] : []),
                  ...(job.sponsorsWorkPass ? [{ label: jobLabels('facts.workPass'), tone: 'success' as const }] : []),
                ]}
              /></li>
            })}
          </ul>
        )}
        {(firstHref || nextHref) && <nav aria-label={t('jobPagination')} className="mt-5 flex flex-wrap gap-3">
          {firstHref && <Button asChild variant="secondary"><Link href={firstHref} prefetch={false} scroll={false}>{t('firstJobs')}</Link></Button>}
          {nextHref && <Button asChild variant="secondary"><Link href={nextHref} prefetch={false} scroll={false}>{t('nextJobs')}</Link></Button>}
        </nav>}
      </section>
    </div>
  )
}
