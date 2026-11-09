import type { Metadata } from 'next'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { requireAdmin } from '@/server/authz'
import { ForbiddenError, TwoFactorRequiredError } from '@/server/errors'
import { listAuditLogs } from '@/server/services/admin-audit'
import { AUDIT_ACTIONS } from '@/server/lib/audit-actions'

export const dynamic = 'force-dynamic'

function formatKL(date: Date): string {
  return date.toLocaleString('zh-CN', {
    timeZone: 'Asia/Kuala_Lumpur',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  })
}

function str(v: unknown): string | undefined {
  if (typeof v === 'string' && v.length > 0) return v
  return undefined
}

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('adminAudit')
  return { title: `${t('title')} · FindMYJob`, robots: { index: false, follow: false } }
}

export default async function AdminAuditPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { locale } = await params
  const sp = await searchParams

  try {
    await requireAdmin(await headers())
  } catch (err) {
    if (err instanceof TwoFactorRequiredError) redirect(`/${locale}/two-factor/setup`)
    if (err instanceof ForbiddenError) {
      redirect(`/${locale}/login`)
    }
    throw err
  }

  const t = await getTranslations('adminAudit')

  const action = str(Array.isArray(sp.action) ? sp.action[0] : sp.action)
  const actorEmail = str(Array.isArray(sp.actorEmail) ? sp.actorEmail[0] : sp.actorEmail)
  const dateFrom = str(Array.isArray(sp.dateFrom) ? sp.dateFrom[0] : sp.dateFrom)
  const dateTo = str(Array.isArray(sp.dateTo) ? sp.dateTo[0] : sp.dateTo)
  const cursor = str(Array.isArray(sp.cursor) ? sp.cursor[0] : sp.cursor)

  // requireAdmin was already called above; we have an authenticated context
  const ctx = await requireAdmin(await headers())

  const { items, nextCursor } = await listAuditLogs(ctx, {
    action,
    actorEmail,
    dateFrom,
    dateTo,
    cursor,
  })

  const nextUrl = nextCursor
    ? `/${locale}/admin/audit?${new URLSearchParams({
        ...(action ? { action } : {}),
        ...(actorEmail ? { actorEmail } : {}),
        ...(dateFrom ? { dateFrom } : {}),
        ...(dateTo ? { dateTo } : {}),
        cursor: nextCursor,
      }).toString()}`
    : null

  return (
    <main id="main-content" className="p-4 md:p-6 max-w-7xl mx-auto">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">{t('title')}</h1>
          <p className="mt-1 text-sm text-gray-600">{t('description')}</p>
        </div>
      </div>

      {/* Filter form */}
      <form method="GET" action={`/${locale}/admin/audit`} className="mb-5 flex flex-wrap gap-3">
        <select
          name="action"
          aria-label={t('filterAction')}
          defaultValue={action ?? ''}
          className="h-10 rounded-lg border border-gray-200 bg-white px-3 text-sm"
        >
          <option value="">{t('filterAction')}</option>
          {AUDIT_ACTIONS.map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </select>

        <input
          type="email"
          name="actorEmail"
          defaultValue={actorEmail ?? ''}
          placeholder={t('filterActorEmail')}
          className="h-10 rounded-lg border border-gray-200 bg-white px-3 text-sm w-56"
        />

        <input
          type="date"
          name="dateFrom"
          defaultValue={dateFrom ?? ''}
          aria-label={t('filterDateFrom')}
          className="h-10 rounded-lg border border-gray-200 bg-white px-3 text-sm"
        />

        <input
          type="date"
          name="dateTo"
          defaultValue={dateTo ?? ''}
          aria-label={t('filterDateTo')}
          className="h-10 rounded-lg border border-gray-200 bg-white px-3 text-sm"
        />

        <button
          type="submit"
          className="h-10 rounded-lg bg-[var(--color-brand-600,#2563eb)] px-4 text-sm font-medium text-white hover:opacity-90"
        >
          {t('filterSubmit')}
        </button>
      </form>

      {/* Results table */}
      <div
        className="rounded-xl border border-gray-200 bg-white overflow-x-auto"
        tabIndex={0}
        role="region"
        aria-label={t('title')}
      >
        <table className="w-full min-w-[720px] text-sm">
          <thead className="border-b border-gray-100 bg-gray-50/60 text-left text-gray-600">
            <tr>
              <th className="px-5 py-3 font-medium whitespace-nowrap">{t('colTime')}</th>
              <th className="px-3 py-3 font-medium">{t('colActor')}</th>
              <th className="px-3 py-3 font-medium">{t('colAction')}</th>
              <th className="px-5 py-3 font-medium">{t('colTarget')}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {items.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-5 py-8 text-center text-gray-600 text-sm">
                  {t('noResults')}
                </td>
              </tr>
            ) : (
              items.map((item) => (
                <tr key={item.id}>
                  <td className="whitespace-nowrap px-5 py-3 text-gray-600 text-xs">
                    {formatKL(item.createdAt)}
                  </td>
                  <td className="px-3 py-3">
                    <div className="text-sm font-medium text-gray-800">{item.actorName ?? '—'}</div>
                    {item.actorEmail && (
                      <div className="text-xs text-gray-600">{item.actorEmail}</div>
                    )}
                    {item.actorRole && (
                      <div className="text-xs text-gray-600">{item.actorRole}</div>
                    )}
                  </td>
                  <td className="px-3 py-3">
                    <code className="rounded bg-gray-100 px-1.5 py-0.5 text-xs font-mono">
                      {item.action}
                    </code>
                  </td>
                  <td className="px-5 py-3 text-gray-600 text-xs">
                    {item.targetType}
                    {item.targetId ? ` / ${item.targetId.slice(0, 12)}…` : ''}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {nextUrl && (
        <div className="mt-4 flex justify-end">
          <a
            href={nextUrl}
            className="rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            {t('nextPage')}
          </a>
        </div>
      )}
    </main>
  )
}
