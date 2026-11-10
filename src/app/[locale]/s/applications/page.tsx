import { headers } from 'next/headers'
import { getTranslations, getLocale } from 'next-intl/server'
import { Link } from '@/i18n/navigation'
import { requireStudent } from '@/server/authz'
import { listStudentApplications } from '@/server/services/applications'
import { formatKLDate } from '@/lib/format-date'
import type { ApplicationStatus } from '@prisma/client'
import { WithdrawButton } from './_components/WithdrawButton'

function statusBadgeClass(status: ApplicationStatus): string {
  switch (status) {
    case 'HIRED':
      return 'bg-green-100 text-green-800'
    case 'OFFER':
      return 'bg-emerald-100 text-emerald-800'
    case 'SHORTLISTED':
    case 'INTERVIEW':
      return 'bg-blue-100 text-blue-800'
    case 'VIEWED':
      return 'bg-sky-100 text-sky-800'
    case 'REJECTED':
      return 'bg-red-100 text-red-800'
    case 'WITHDRAWN':
      return 'bg-muted text-muted-foreground'
    default:
      return 'bg-secondary text-secondary-foreground'
  }
}

export default async function MyApplicationsPage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  void locale
  const detectedLocale = await getLocale()
  const t = await getTranslations('myApplications')
  const { userId } = await requireStudent(await headers())
  const applications = await listStudentApplications({ userId })

  return (
    <div className="container mx-auto max-w-3xl px-4 py-8">
      <h1 className="mb-6 text-2xl font-bold">{t('title')}</h1>

      {applications.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('empty')}</p>
      ) : (
        <ul className="space-y-4">
          {applications.map((app) => (
            <li key={app.id} className="rounded-lg border p-4 space-y-3">
              {/* Header: job title + status */}
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <Link
                    href={`/jobs/${app.job.id}`}
                    prefetch={false}
                    className="font-semibold hover:underline underline-offset-2 text-base"
                  >
                    {app.job.title}
                  </Link>
                  <p className="text-sm text-muted-foreground mt-0.5">{app.job.companyName}</p>
                </div>
                <span
                  className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium shrink-0 ${statusBadgeClass(app.status)}`}
                >
                  {t(`status.${app.status}` as Parameters<typeof t>[0])}
                </span>
              </div>

              {/* Applied date */}
              <p className="text-xs text-muted-foreground">
                {t('appliedAt')}: {formatKLDate(app.createdAt, detectedLocale)}
              </p>

              {/* Cover note */}
              {app.coverNote && (
                <div>
                  <p className="text-xs font-medium text-muted-foreground mb-1">{t('coverNoteLabel')}</p>
                  <p className="text-sm whitespace-pre-wrap break-words">{app.coverNote}</p>
                </div>
              )}

              {/* Status timeline */}
              {app.events.length > 0 && (
                <div>
                  <p className="text-xs font-medium text-muted-foreground mb-2">{t('timelineLabel')}</p>
                  <ol className="space-y-1">
                    {app.events.map((ev) => (
                      <li key={ev.id} className="flex items-center gap-2 text-xs text-muted-foreground">
                        <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/50 shrink-0" aria-hidden="true" />
                        <span className="font-medium text-foreground">
                          {t(`status.${ev.toStatus}` as Parameters<typeof t>[0])}
                        </span>
                        <span>·</span>
                        <span>{formatKLDate(ev.createdAt, detectedLocale)}</span>
                      </li>
                    ))}
                  </ol>
                </div>
              )}

              {/* Withdraw button */}
              {app.status !== 'WITHDRAWN' && (
                <div>
                  <WithdrawButton applicationId={app.id} />
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
