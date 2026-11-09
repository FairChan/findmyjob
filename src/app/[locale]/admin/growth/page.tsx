import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { requireAdmin } from '@/server/authz'
import { ForbiddenError, TwoFactorRequiredError, ValidationError } from '@/server/errors'
import { getGrowthSummary } from '@/server/services/admin-growth'
import { listReferrals, listReferralsSchema } from '@/server/services/referrals'
import { formatKLDateTime } from '@/lib/format-date'
import { ReferralActions } from './referral-actions'
import { AdminActionFeedback } from '@/components/admin/admin-action-feedback'

const fieldClass = 'h-10 w-full min-w-0 rounded-lg border border-gray-300 bg-white px-3 text-sm focus-visible:outline-2 focus-visible:outline-blue-600'

export default async function GrowthPage({ params, searchParams }: {
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
  const t = await getTranslations('adminGrowth')
  const raw = await searchParams
  const parsed = listReferralsSchema.safeParse({
    status: raw.status === '' ? undefined : raw.status,
    referrerId: raw.referrerId === '' ? undefined : raw.referrerId,
    cursor: raw.cursor,
  })
  const summary = await getGrowthSummary(ctx)
  let invalid = !parsed.success
  let result: Awaited<ReturnType<typeof listReferrals>> = { items: [], nextCursor: null }
  if (parsed.success) {
    try {
      result = await listReferrals(ctx, { ...parsed.data, limit: 25 })
    } catch (error) {
      if (!(error instanceof ValidationError)) throw error
      invalid = true
    }
  }
  const query: NonNullable<Parameters<typeof listReferrals>[1]> = parsed.success ? parsed.data : {}
  const path = '/' + locale + '/admin/growth'
  const next = new URLSearchParams()
  if (query.status) next.set('status', query.status)
  if (query.referrerId) next.set('referrerId', query.referrerId)
  if (result.nextCursor) next.set('cursor', result.nextCursor)
  const statuses = { PENDING: t('pending'), QUALIFIED: t('qualified'), VOID: t('voided') }
  const progressMax = Math.max(1, summary.signupCap, summary.studentCount)

  return (
    <main id="main-content" className="mx-auto w-full max-w-6xl space-y-6 p-4 md:p-6">
      <AdminActionFeedback>
      <div><h1 className="text-2xl font-semibold">{t('title')}</h1><p className="mt-2 text-sm text-gray-600">{t('description')}</p></div>
      <section aria-label={t('signupProgress')} className="space-y-3 rounded-xl border border-gray-200 bg-white p-5">
        <p className="text-sm font-medium">{t('signupCount', { count: summary.studentCount, cap: summary.signupCap })}</p>
        <div role="progressbar" aria-label={t('signupProgress')} aria-valuemin={0} aria-valuemax={progressMax} aria-valuenow={summary.studentCount} className="h-3 overflow-hidden rounded-full bg-gray-100">
          <div className="h-full rounded-full bg-blue-600" style={{ width: Math.min(100, summary.studentCount / progressMax * 100) + '%' }} />
        </div>
      </section>
      <form method="GET" action={path} className="grid items-end gap-3 sm:grid-cols-[1fr_2fr_auto]">
        <div className="space-y-1 text-sm font-medium"><label htmlFor="referral-status">{t('status')}</label>
          <select id="referral-status" name="status" defaultValue={query.status ?? ''} className={fieldClass}>
            <option value="">{t('all')}</option>
            {Object.entries(statuses).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </div>
        <div className="space-y-1 text-sm font-medium"><label htmlFor="referrer-id">{t('referrerId')}</label>
          <input id="referrer-id" name="referrerId" defaultValue={query.referrerId ?? ''} maxLength={128} className={fieldClass} />
        </div>
        <button type="submit" className="h-10 rounded-lg bg-blue-700 px-4 text-sm font-medium text-white hover:bg-blue-800">{t('filter')}</button>
      </form>
      <a href={path} className="inline-block text-sm text-blue-700 underline underline-offset-2">{t('reset')}</a>
      {invalid ? <p role="alert" className="rounded-lg border border-red-200 bg-white p-4 text-sm text-red-800">{t('errorQuery')}</p> : (
        <section aria-label={t('referrals')} className="space-y-3">
          {result.items.length === 0 && <p className="rounded-xl border border-gray-200 bg-white p-6 text-sm text-gray-600">{t('empty')}</p>}
          {result.items.map((row) => (
            <article key={row.id} data-testid={'referral-' + row.id} className="min-w-0 space-y-4 rounded-xl border border-gray-200 bg-white p-4 sm:p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <span className="rounded-full bg-gray-100 px-3 py-1 text-xs font-semibold text-gray-800">{statuses[row.status]}</span>
                {row.status !== 'VOID' && <ReferralActions referralId={row.id} />}
              </div>
              <dl className="grid min-w-0 gap-4 text-sm sm:grid-cols-2">
                <div className="min-w-0"><dt className="text-gray-600">{t('referrer')}</dt><dd className="mt-1 break-words font-medium">{row.referrerName}</dd><dd className="mt-1 break-all text-xs text-gray-600">{row.referrerId}</dd></div>
                <div className="min-w-0"><dt className="text-gray-600">{t('invitee')}</dt><dd className="mt-1 break-words font-medium">{row.inviteeName}</dd><dd className="mt-1 break-all text-xs text-gray-600">{row.inviteeId}</dd></div>
                <div><dt className="text-gray-600">{t('createdAt')}</dt><dd className="mt-1">{formatKLDateTime(row.createdAt, locale)}</dd></div>
                <div><dt className="text-gray-600">{t('qualifiedAt')}</dt><dd className="mt-1">{row.qualifiedAt ? formatKLDateTime(row.qualifiedAt, locale) : t('notAvailable')}</dd></div>
                {row.voidReason && <div className="min-w-0 sm:col-span-2"><dt className="text-gray-600">{t('voidReason')}</dt><dd className="mt-1 whitespace-pre-wrap [overflow-wrap:anywhere]">{row.voidReason}</dd></div>}
              </dl>
            </article>
          ))}
        </section>
      )}
      {!invalid && result.nextCursor && <a href={path + '?' + next.toString()} className="inline-flex min-h-10 items-center rounded-lg border border-gray-300 bg-white px-4 text-sm">{t('next')}</a>}
      </AdminActionFeedback>
    </main>
  )
}

