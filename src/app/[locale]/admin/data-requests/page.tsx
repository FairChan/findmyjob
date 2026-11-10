import { headers } from 'next/headers'
import { getTranslations } from 'next-intl/server'
import { z } from 'zod'
import { requireAdmin } from '@/server/authz'
import { listDataRequestsForAdmin } from '@/server/services/data-rights'
import { DataRequestActions } from '@/components/admin/data-request-actions'
import { formatKLDate } from '@/lib/format-date'

const searchParamsSchema = z.object({
  status: z.enum(['OPEN', 'DONE', 'REJECTED']).optional(),
  cursor: z.string().optional(),
})

export default async function AdminDataRequestsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { locale } = await params
  const ctx = await requireAdmin(await headers())
  void ctx // authz

  const rawSearch = await searchParams
  const parsed = searchParamsSchema.safeParse({
    status: typeof rawSearch.status === 'string' ? rawSearch.status : undefined,
    cursor: typeof rawSearch.cursor === 'string' ? rawSearch.cursor : undefined,
  })

  const { status, cursor } = parsed.success ? parsed.data : {}

  const { rows, hasMore, nextCursor } = await listDataRequestsForAdmin({ status, cursor })
  const t = await getTranslations('adminDataRequests')

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <h1 className="text-2xl font-bold mb-4">{t('title')}</h1>

      {/* Status filter */}
      <div className="flex flex-wrap gap-2 mb-6">
        {[undefined, 'OPEN', 'DONE', 'REJECTED'].map((s) => (
          <a
            key={s ?? 'all'}
            href={`/${locale}/admin/data-requests${s ? `?status=${s}` : ''}`}
            className={`px-3 py-1.5 rounded-full text-sm border transition-colors ${
              status === s
                ? 'bg-primary text-primary-foreground border-primary'
                : 'border-border text-muted-foreground hover:bg-muted'
            }`}
          >
            {s ? t(`status_${s}`) : t('statusAll')}
          </a>
        ))}
      </div>

      {rows.length === 0 ? (
        <p className="text-muted-foreground">{t('empty')}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="text-left p-3 font-medium">{t('colType')}</th>
                <th className="text-left p-3 font-medium">{t('colUser')}</th>
                <th className="text-left p-3 font-medium">{t('colStatus')}</th>
                <th className="text-left p-3 font-medium">{t('colCreatedAt')}</th>
                <th className="p-3"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((req) => (
                <tr key={req.id} className="border-b hover:bg-muted/30">
                  <td className="p-3 font-medium">{t(`type_${req.type}`)}</td>
                  <td className="p-3 text-muted-foreground">{req.user.id}</td>
                  <td className="p-3">
                    <span
                      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs ${
                        req.status === 'OPEN'
                          ? 'bg-yellow-100 text-yellow-800'
                          : req.status === 'DONE'
                            ? 'bg-green-100 text-green-800'
                            : 'bg-red-100 text-red-800'
                      }`}
                    >
                      {t(`status_${req.status}`)}
                    </span>
                  </td>
                  <td className="p-3 text-muted-foreground">
                    {formatKLDate(req.createdAt, locale)}
                  </td>
                  <td className="p-3 text-right">
                    {req.type === 'CORRECT' && req.status === 'OPEN' && (
                      <DataRequestActions requestId={req.id} locale={locale} />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {hasMore && nextCursor && (
        <div className="mt-4">
          <a
            href={`/${locale}/admin/data-requests?${status ? `status=${status}&` : ''}cursor=${nextCursor}`}
            className="text-sm text-primary underline-offset-4 hover:underline"
          >
            {t('loadMore')}
          </a>
        </div>
      )}
    </div>
  )
}
