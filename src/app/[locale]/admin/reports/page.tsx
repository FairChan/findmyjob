import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { requireAdmin } from '@/server/authz'
import { ForbiddenError, TwoFactorRequiredError, ValidationError } from '@/server/errors'
import { listReports, listReportsSchema } from '@/server/services/reports'
import { formatKLDateTime } from '@/lib/format-date'
import { ReportActions } from './report-actions'
import { AdminActionFeedback } from '@/components/admin/admin-action-feedback'

const fieldClass = 'h-10 w-full min-w-0 rounded-lg border border-gray-300 bg-white px-3 text-sm focus-visible:outline-2 focus-visible:outline-blue-600'

export default async function ReportsPage({ params, searchParams }: {
  params: Promise<{ locale: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { locale } = await params
  let ctx
  try {
    ctx = await requireAdmin(await headers())
  } catch (error) {
    if (error instanceof TwoFactorRequiredError) redirect('/' + locale + '/two-factor/setup')
    if (error instanceof ForbiddenError) redirect('/' + locale + '/login')
    throw error
  }
  const t = await getTranslations('adminReports')
  const raw = await searchParams
  const parsed = listReportsSchema.safeParse({
    status: raw.status === '' || raw.status === undefined ? 'OPEN' : raw.status,
    jobId: raw.jobId === '' ? undefined : raw.jobId,
    cursor: raw.cursor,
  })
  let invalid = !parsed.success
  let result: Awaited<ReturnType<typeof listReports>> = { items: [], nextCursor: null }
  if (parsed.success) {
    try {
      result = await listReports(ctx, { ...parsed.data, limit: 25 })
    } catch (error) {
      if (!(error instanceof ValidationError)) throw error
      invalid = true
    }
  }
  const query = parsed.success ? parsed.data : { status: 'OPEN' as const, jobId: undefined }
  const path = '/' + locale + '/admin/reports'
  const next = new URLSearchParams({ status: query.status ?? 'OPEN' })
  if (query.jobId) next.set('jobId', query.jobId)
  if (result.nextCursor) next.set('cursor', result.nextCursor)
  const statuses = { OPEN: t('open'), RESOLVED: t('resolved'), DISMISSED: t('dismissed') }

  return (
    <main id="main-content" className="mx-auto w-full max-w-6xl space-y-6 p-4 md:p-6">
      <AdminActionFeedback>
      <div><h1 className="text-2xl font-semibold">{t('title')}</h1><p className="mt-2 text-sm text-gray-600">{t('description')}</p></div>
      <form method="GET" action={path} className="grid items-end gap-3 sm:grid-cols-[1fr_2fr_auto]">
        <div className="space-y-1 text-sm font-medium"><label htmlFor="report-status">{t('status')}</label>
          <select id="report-status" name="status" defaultValue={query.status ?? 'OPEN'} className={fieldClass}>{Object.entries(statuses).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
        </div>
        <div className="space-y-1 text-sm font-medium"><label htmlFor="report-job-id">{t('jobId')}</label><input id="report-job-id" name="jobId" defaultValue={query.jobId ?? ''} maxLength={128} className={fieldClass} /></div>
        <button type="submit" className="h-10 rounded-lg bg-blue-700 px-4 text-sm font-medium text-white hover:bg-blue-800">{t('filter')}</button>
      </form>
      <a href={path} className="inline-block text-sm text-blue-700 underline underline-offset-2">{t('reset')}</a>
      {invalid ? <p role="alert" className="rounded-lg border border-red-200 bg-white p-4 text-sm text-red-800">{t('errorQuery')}</p> : (
        <div className="space-y-3">
          {result.items.length === 0 && <p className="rounded-xl border border-gray-200 bg-white p-6 text-sm text-gray-600">{t('empty')}</p>}
          {result.items.map((row) => (
            <article key={row.id} data-testid={'report-' + row.id} className="min-w-0 space-y-4 rounded-xl border border-gray-200 bg-white p-4 sm:p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1"><h2 className="break-words font-semibold">{row.jobTitle}</h2><p className="mt-1 break-words text-sm text-gray-600">{row.companyName}</p></div>
                <span className="rounded-full bg-gray-100 px-3 py-1 text-xs font-semibold text-gray-800">{statuses[row.status]}</span>
              </div>
              <dl className="grid min-w-0 gap-4 text-sm sm:grid-cols-2">
                <div><dt className="text-gray-600">{t('reason')}</dt><dd className="mt-1 font-medium">{t('reasons.' + row.reason)}</dd></div>
                <div><dt className="text-gray-600">{t('createdAt')}</dt><dd className="mt-1">{formatKLDateTime(row.createdAt, locale)}</dd></div>
                <div className="min-w-0 sm:col-span-2"><dt className="text-gray-600">{t('note')}</dt><dd className="mt-1 whitespace-pre-wrap [overflow-wrap:anywhere]">{row.note || t('notAvailable')}</dd></div>
                <div className="min-w-0"><dt className="text-gray-600">{t('reporterId')}</dt><dd className="mt-1 break-all text-xs">{row.reporterId}</dd></div>
                {row.status !== 'OPEN' && <><div className="min-w-0"><dt className="text-gray-600">{t('resolverId')}</dt><dd className="mt-1 break-all text-xs">{row.resolverId || t('notAvailable')}</dd></div><div><dt className="text-gray-600">{t('resolvedAt')}</dt><dd className="mt-1">{row.resolvedAt ? formatKLDateTime(row.resolvedAt, locale) : t('notAvailable')}</dd></div></>}
              </dl>
              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-gray-100 pt-4">
                <a href={'/' + locale + '/admin/jobs/' + encodeURIComponent(row.jobId)} className="text-sm text-blue-700 underline underline-offset-2">{t('viewJob')}</a>
                {row.status === 'OPEN' && <ReportActions reportId={row.id} />}
              </div>
            </article>
          ))}
        </div>
      )}
      {!invalid && result.nextCursor && <a href={path + '?' + next.toString()} className="inline-flex min-h-10 items-center rounded-lg border border-gray-300 bg-white px-4 text-sm">{t('next')}</a>}
      </AdminActionFeedback>
    </main>
  )
}

