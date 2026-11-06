import type { Metadata } from 'next'
import { getTranslations } from 'next-intl/server'
import { Link } from '@/i18n/navigation'
import { db } from '@/server/db'
import { toJobListItem } from '@/server/serializers/job'

interface PageProps {
  params: Promise<{ locale: string }>
  searchParams: Promise<{ q?: string; type?: string; state?: string; workMode?: string }>
}

export async function generateMetadata({ searchParams }: PageProps): Promise<Metadata> {
  const { q, type, state, workMode } = await searchParams
  const hasFilters = !!(q || type || state || workMode)
  return {
    robots: hasFilters ? 'noindex,follow' : undefined,
  }
}

export default async function JobsPage({ params, searchParams }: PageProps) {
  const { locale } = await params
  const { q, type, state, workMode } = await searchParams
  const t = await getTranslations('publicJobs')

  const now = new Date()

  const jobs = await db.job.findMany({
    where: {
      status: 'PUBLISHED',
      OR: [{ deadline: null }, { deadline: { gt: now } }],
      ...(type ? { type: type as 'INTERNSHIP' | 'FULL_TIME' | 'PART_TIME' } : {}),
      ...(state ? { state } : {}),
      ...(workMode ? { workMode: workMode as 'ONSITE' | 'HYBRID' | 'REMOTE' } : {}),
      ...(q
        ? {
            OR: [
              { title: { contains: q, mode: 'insensitive' } },
              { category: { contains: q, mode: 'insensitive' } },
              { skills: { has: q } },
            ],
          }
        : {}),
    },
    orderBy: { publishedAt: 'desc' },
    select: {
      id: true,
      title: true,
      type: true,
      category: true,
      workMode: true,
      state: true,
      city: true,
      salaryMin: true,
      salaryMax: true,
      salaryVisible: true,
      languages: true,
      skills: true,
      acceptsStudentPass: true,
      sponsorsWorkPass: true,
      headcount: true,
      deadline: true,
      publishedAt: true,
      company: {
        select: {
          id: true,
          displayNameZh: true,
          displayNameEn: true,
          legalName: true,
        },
      },
    },
  })

  const items = jobs.map(toJobListItem)

  return (
    <div className="container mx-auto max-w-4xl px-4 py-8">
      <h1 className="text-2xl font-bold mb-6">{t('title')}</h1>

      {items.length === 0 ? (
        <p className="text-muted-foreground text-sm">{t('empty')}</p>
      ) : (
        <ul className="space-y-4">
          {items.map((job) => {
            const companyName =
              locale === 'zh'
                ? (job.company.displayNameZh ?? job.company.legalName)
                : (job.company.displayNameEn ?? job.company.legalName)
            return (
              <li
                key={job.id}
                className="rounded-lg border bg-card p-4 hover:border-primary/50 transition-colors"
              >
                <Link href={`/jobs/${job.id}`} prefetch={false} className="block">
                  <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2">
                    <div className="min-w-0">
                      <h2 className="font-semibold text-foreground truncate">
                        {job.title}
                      </h2>
                      <p className="text-sm text-muted-foreground mt-0.5">{companyName}</p>
                    </div>
                    <div className="flex flex-wrap gap-1.5 flex-shrink-0">
                      <span className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-xs font-medium">
                        {t(`type.${job.type}`)}
                      </span>
                      {job.state && (
                        <span className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-xs font-medium">
                          {job.state}
                        </span>
                      )}
                    </div>
                  </div>
                  {(job.salaryMin != null || job.salaryMax != null) && (
                    <p className="mt-2 text-sm font-medium text-brand">
                      {job.salaryMin != null && job.salaryMax != null
                        ? `MYR ${job.salaryMin.toLocaleString()} – ${job.salaryMax.toLocaleString()}`
                        : job.salaryMin != null
                          ? `MYR ${job.salaryMin.toLocaleString()}+`
                          : `≤ MYR ${job.salaryMax!.toLocaleString()}`}
                    </p>
                  )}
                </Link>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
