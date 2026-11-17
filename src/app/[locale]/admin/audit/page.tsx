import { Select } from '@/components/ui/select'
import type { Metadata } from 'next'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { requireAdmin } from '@/server/authz'
import { ForbiddenError, TwoFactorRequiredError } from '@/server/errors'
import { listAuditLogs } from '@/server/services/admin-audit'
import { AUDIT_ACTIONS } from '@/server/lib/audit-actions'
import { formatKLDateTime } from '@/lib/format-date'

export const dynamic = 'force-dynamic'

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
    <div className="p-4 md:p-6 max-w-7xl mx-auto">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">{t('title')}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t('description')}</p>
        </div>
      </div>

      {/* Filter form */}
      <form method="GET" action={`/${locale}/admin/audit`} className="mb-5 flex flex-wrap gap-3">
        <Select
          name="action"
          aria-label={t('filterAction')}
          defaultValue={action ?? ''}
          className="h-10 rounded-card border border-border bg-card px-3 text-sm"
        >
          <option value="">{t('filterAction')}</option>
          {AUDIT_ACTIONS.map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </Select>

        <input
          type="email"
          name="actorEmail"
          defaultValue={actorEmail ?? ''}
          placeholder={t('filterActorEmail')}
          className="h-10 rounded-card border border-border bg-card px-3 text-sm w-56"
        />

        <input
          type="date"
          name="dateFrom"
          defaultValue={dateFrom ?? ''}
          aria-label={t('filterDateFrom')}
          className="h-10 rounded-card border border-border bg-card px-3 text-sm"
        />

        <input
          type="date"
          name="dateTo"
          defaultValue={dateTo ?? ''}
          aria-label={t('filterDateTo')}
          className="h-10 rounded-card border border-border bg-card px-3 text-sm"
        />

        <button
          type="submit"
          className="h-10 rounded-full bg-brand px-5 text-sm font-medium text-brand-foreground hover:bg-brand/90"
        >
          {t('filterSubmit')}
        </button>
      </form>

      {/* Results table */}
      <div
        className="rounded-card border border-border bg-card overflow-x-auto"
        tabIndex={0}
        role="region"
        aria-label={t('title')}
      >
        <table className="w-full min-w-[720px] text-sm">
          <thead className="border-b border-border bg-muted/60 text-left text-muted-foreground">
            <tr>
              <th className="px-5 py-3 font-medium whitespace-nowrap">{t('colTime')}</th>
              <th className="px-3 py-3 font-medium">{t('colActor')}</th>
              <th className="px-3 py-3 font-medium">{t('colAction')}</th>
              <th className="px-5 py-3 font-medium">{t('colTarget')}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {items.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-5 py-8 text-center text-muted-foreground text-sm">
                  {t('noResults')}
                </td>
              </tr>
            ) : (
              items.map((item) => (
                <tr key={item.id}>
                  <td className="whitespace-nowrap px-5 py-3 text-muted-foreground text-xs">
                    {formatKLDateTime(item.createdAt, locale)}
                  </td>
                  <td className="px-3 py-3">
                    <div className="text-sm font-medium text-foreground">{item.actorName ?? '—'}</div>
                    {item.actorEmail && (
                      <div className="text-xs text-muted-foreground">{item.actorEmail}</div>
                    )}
                    {item.actorRole && (
                      <div className="text-xs text-muted-foreground">{item.actorRole}</div>
                    )}
                  </td>
                  <td className="px-3 py-3">
                    <code className="rounded bg-muted px-1.5 py-0.5 text-xs font-mono">
                      {item.action}
                    </code>
                  </td>
                  <td className="px-5 py-3 text-muted-foreground text-xs">
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
            className="rounded-card border border-border bg-card px-4 py-2 text-sm font-medium text-foreground hover:bg-muted"
          >
            {t('nextPage')}
          </a>
        </div>
      )}
    </div>
  )
}
