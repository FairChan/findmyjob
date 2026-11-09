import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { Link } from '@/i18n/navigation'
import { requireAdmin } from '@/server/authz'
import { ForbiddenError, TwoFactorRequiredError, ValidationError } from '@/server/errors'
import { listPlansAdmin, listPlansAdminSchema } from '@/server/services/admin-plans'
import { formatKLDateTime } from '@/lib/format-date'
import { Button } from '@/components/ui/button'
import { DeletePlanDialog } from './delete-plan-dialog'
import { PlanFeedback } from './plan-feedback'
import { PlanForm } from './plan-form'

export default async function PlansPage({ params, searchParams }: {
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
  const t = await getTranslations({ locale, namespace: 'adminPlans' })
  const raw = await searchParams
  const parsed = listPlansAdminSchema.safeParse({
    active: raw.active === '' ? undefined : raw.active === 'true' ? true : raw.active === 'false' ? false : raw.active,
    limit: typeof raw.limit === 'string' && /^\d+$/.test(raw.limit) ? Number(raw.limit) : raw.limit,
    cursor: raw.cursor,
  })
  let invalid = !parsed.success
  let result: Awaited<ReturnType<typeof listPlansAdmin>> = { items: [], nextCursor: null }
  if (parsed.success) {
    try {
      result = await listPlansAdmin(ctx, parsed.data)
    } catch (error) {
      if (error instanceof ForbiddenError) redirect('/' + locale + '/login')
      if (!(error instanceof ValidationError)) throw error
      invalid = true
    }
  }
  const query = parsed.success ? parsed.data : {}
  const path = '/' + locale + '/admin/plans'
  const next = new URLSearchParams()
  if (query.active !== undefined) next.set('active', String(query.active))
  if (query.limit !== undefined) next.set('limit', String(query.limit))
  if (result.nextCursor) next.set('cursor', result.nextCursor)

  return (
    <div className="mx-auto w-full max-w-6xl space-y-5 p-4 md:p-6">
      <PlanFeedback title={t('title')} description={t('description')} actions={<>
        <Link href="/pricing" className="inline-flex min-h-10 items-center text-sm text-blue-700 underline underline-offset-2">{t('openPricing')}</Link>
        <PlanForm />
      </>}>
        <form method="GET" action={path} className="flex flex-wrap items-end gap-3 rounded-xl border border-gray-200 bg-white p-4">
          <div className="min-w-0 flex-1 space-y-1 text-sm font-medium">
            <label htmlFor="plan-active-filter">{t('filterActive')}</label>
            <select key={query.active === undefined ? 'all' : String(query.active)} id="plan-active-filter" name="active" defaultValue={query.active === undefined ? '' : String(query.active)} className="h-10 w-full rounded-lg border border-gray-300 bg-white px-3 text-base focus-visible:outline-2 focus-visible:outline-blue-600">
              <option value="">{t('all')}</option><option value="true">{t('active')}</option><option value="false">{t('inactive')}</option>
            </select>
          </div>
          {query.limit !== undefined && <input type="hidden" name="limit" value={query.limit} />}
          <Button type="submit">{t('filter')}</Button>
          <a href={path} className="inline-flex min-h-10 items-center text-sm text-blue-700 underline underline-offset-2">{t('reset')}</a>
        </form>
        {invalid ? <p role="alert" className="rounded-lg border border-red-200 bg-white p-4 text-sm text-red-800">{t('errorQuery')}</p> : (
          <div className="space-y-3">
            {result.items.length === 0 && <p className="rounded-xl border border-gray-200 bg-white p-6 text-sm text-gray-600">{t('empty')}</p>}
            {result.items.map((row) => {
              const name = locale === 'zh' ? row.nameZh : row.nameEn
              const clientRow = { ...row, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() }
              const legacy = row.kind === 'STUDENT_VIEW_PACK'
              const pack = row.kind === 'CREDIT_PACK'
              return <article key={row.id} data-testid={'plan-' + row.id} className="min-w-0 space-y-4 rounded-xl border border-gray-200 bg-white p-4 sm:p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1"><h2 className="break-words font-semibold [overflow-wrap:anywhere]">{name}</h2><p className="mt-1 break-all font-mono text-xs text-gray-600">{row.code}</p></div>
                  <div className="flex flex-wrap gap-2">
                    {row.kind === 'PLAN' || row.kind === 'CREDIT_PACK' ? <PlanForm plan={{ ...clientRow, kind: row.kind }} /> : <Button variant="outline" size="sm" disabled>{t('edit')}</Button>}
                    <DeletePlanDialog id={row.id} name={name} protectedPlan={row.code === 'FREE'} />
                  </div>
                </div>
                <div className="flex flex-wrap gap-2 text-xs">
                  <span className="rounded-full bg-gray-100 px-3 py-1 font-semibold text-gray-800">{t(row.isActive ? 'active' : 'inactive')}</span>
                  <span className="rounded-full bg-gray-100 px-3 py-1 text-gray-800">{t(row.isPublic ? 'public' : 'hidden')}</span>
                  <span className="rounded-full bg-blue-50 px-3 py-1 text-blue-900">{legacy ? t('kinds.STUDENT_VIEW_PACK') : row.kind === 'PLAN' ? t('kinds.PLAN') : t('kinds.CREDIT_PACK')}</span>
                </div>
                {legacy ? <p className="text-sm text-gray-600">{t('legacyStudentProtected')}</p> : <>
                  {pack && <p className="text-sm text-gray-600">{t('noSubscription')}</p>}
                  <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm sm:grid-cols-3">
                    <div><dt className="text-gray-600">{t('priceSen')}</dt><dd className="mt-1 font-medium">{row.priceSen}</dd></div>
                    <div><dt className="text-gray-600">{t('credits')}</dt><dd className="mt-1 font-medium">{row.credits}</dd></div>
                    {!pack && <>
                      <div><dt className="text-gray-600">{t('durationDays')}</dt><dd className="mt-1 font-medium">{row.durationDays ?? t('noSubscription')}</dd></div>
                      {(['jobPostLimit', 'seatLimit', 'invitationQuota'] as const).map((key) => <div key={key}><dt className="text-gray-600">{t(key)}</dt><dd className="mt-1 font-medium">{row[key] ?? t('unlimited')}</dd></div>)}
                    </>}
                  </dl>
                </>}
                {row.code === 'FREE' && <p className="text-xs text-gray-600">{t('freeProtected')}</p>}
                <dl className="flex flex-wrap gap-x-8 gap-y-2 border-t border-gray-100 pt-3 text-xs text-gray-600">
                  <div><dt className="inline">{t('sortOrder')}: </dt><dd className="inline">{row.sortOrder}</dd></div>
                  <div><dt className="inline">{t('updatedAt')}: </dt><dd className="inline"><time dateTime={clientRow.updatedAt}>{formatKLDateTime(row.updatedAt, locale)}</time></dd></div>
                </dl>
              </article>
            })}
          </div>
        )}
        {!invalid && result.nextCursor && <a href={path + '?' + next.toString()} className="inline-flex min-h-10 items-center rounded-lg border border-gray-300 bg-white px-4 text-sm">{t('next')}</a>}
      </PlanFeedback>
    </div>
  )
}
