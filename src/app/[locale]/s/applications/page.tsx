import { headers } from 'next/headers'
import { getTranslations, getLocale } from 'next-intl/server'
import { Link } from '@/i18n/navigation'
import { requireStudent } from '@/server/authz'
import { listStudentApplications } from '@/server/services/applications'
import { formatKLDate } from '@/lib/format-date'
import type { ApplicationStatus } from '@prisma/client'
import { WorkspacePage } from '@/components/layout/workspace-page'
import { Badge, type BadgeProps } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/empty-state'
import { WithdrawButton } from './_components/WithdrawButton'

// Cards sit on the muted surface, so the quiet states use the plain chip.
function statusTone(status: ApplicationStatus): BadgeProps['tone'] {
  switch (status) {
    case 'HIRED':
    case 'OFFER':
      return 'success'
    case 'SHORTLISTED':
    case 'INTERVIEW':
    case 'VIEWED':
      return 'brand'
    case 'REJECTED':
      return 'danger'
    default:
      return 'plain'
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
    <WorkspacePage title={t('title')} width="list">
      {applications.length === 0 ? (
        <EmptyState
          title={t('empty')}
          description={t('emptyHint')}
          action={
            <Button asChild variant="brand">
              <Link href="/s/jobs" prefetch={false}>
                {t('browseJobs')}
              </Link>
            </Button>
          }
        />
      ) : (
        <ul className="space-y-3">
          {applications.map((app) => (
            <li key={app.id}>
              <Card className="space-y-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-xs text-muted-foreground">{app.job.companyName}</p>
                    <Link
                      href={`/s/jobs/${app.job.id}`}
                      // Opening a job detail spends the student's view quota.
                      prefetch={false}
                      className="mt-1 inline-block text-body font-semibold leading-snug underline-offset-4 hover:underline"
                    >
                      {app.job.title}
                    </Link>
                  </div>
                  <Badge tone={statusTone(app.status)} className="shrink-0">
                    {t(`status.${app.status}` as Parameters<typeof t>[0])}
                  </Badge>
                </div>

                <p className="text-sm text-muted-foreground">
                  {t('appliedAt')}: {formatKLDate(app.createdAt, detectedLocale)}
                </p>

                {app.coverNote && (
                  <div>
                    <p className="mb-1 text-xs font-medium text-muted-foreground">{t('coverNoteLabel')}</p>
                    <p className="whitespace-pre-wrap break-words text-sm">{app.coverNote}</p>
                  </div>
                )}

                {app.events.length > 0 && (
                  <div>
                    <p className="mb-2 text-xs font-medium text-muted-foreground">{t('timelineLabel')}</p>
                    <ol className="space-y-1.5">
                      {app.events.map((ev) => (
                        <li key={ev.id} className="flex items-center gap-2 text-sm text-muted-foreground">
                          <span
                            className="size-1.5 shrink-0 rounded-full bg-muted-foreground/50"
                            aria-hidden="true"
                          />
                          <span className="font-medium text-foreground">
                            {t(`status.${ev.toStatus}` as Parameters<typeof t>[0])}
                          </span>
                          <span aria-hidden="true">·</span>
                          <span>{formatKLDate(ev.createdAt, detectedLocale)}</span>
                        </li>
                      ))}
                    </ol>
                  </div>
                )}

                {/* Once there is an outcome, withdrawing only confuses both sides. */}
                {['APPLIED', 'VIEWED', 'SHORTLISTED', 'INTERVIEW'].includes(app.status) && (
                  <div>
                    <WithdrawButton applicationId={app.id} />
                  </div>
                )}
              </Card>
            </li>
          ))}
        </ul>
      )}
    </WorkspacePage>
  )
}
