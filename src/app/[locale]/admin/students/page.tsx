import Link from 'next/link'
import { headers } from 'next/headers'
import { getTranslations } from 'next-intl/server'
import { z } from 'zod'
import { requireAdmin } from '@/server/authz'
import { searchStudents, searchStudentsSchema } from '@/server/services/admin-users'

const listParamsSchema = z.object({
  q: z.string().max(200).optional(),
  status: z.enum(['ACTIVE', 'SUSPENDED', 'DELETED']).optional(),
  page: z.coerce.number().int().min(1).default(1),
})

export default async function AdminStudentsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>
  searchParams: Promise<{ q?: string; status?: string; page?: string }>
}) {
  const { locale } = await params
  const sp = await searchParams
  const ctx = await requireAdmin(await headers())
  const t = await getTranslations('adminStudents')

  const parsed = listParamsSchema.safeParse({ q: sp.q?.slice(0, 200), status: sp.status, page: sp.page })
  const { q, status, page } = parsed.success ? parsed.data : searchStudentsSchema.parse({})
  const { items, total } = await searchStudents(ctx, { q, status, page })
  const pageSize = 20
  const totalPages = Math.ceil(total / pageSize)

  return (
    <main id="main-content" className="p-6 max-w-6xl mx-auto">
      <h1 className="text-2xl font-bold mb-6">{t('title')}</h1>

      {/* Search bar */}
      <form method="GET" className="flex gap-2 mb-6">
        <input
          type="text"
          name="q"
          defaultValue={q}
          placeholder={t('searchPlaceholder')}
          className="flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
        />
        <select
          name="status"
          defaultValue={status ?? ''}
          className="rounded-md border border-input bg-background px-3 py-2 text-sm"
        >
          <option value="">{t('statusAll')}</option>
          <option value="ACTIVE">{t('statusActive')}</option>
          <option value="SUSPENDED">{t('statusSuspended')}</option>
        </select>
        <button
          type="submit"
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          {t('searchBtn')}
        </button>
      </form>

      <p className="mb-4 text-sm text-muted-foreground">
        {t('totalCount', { count: total })}
      </p>

      {items.length === 0 ? (
        <p className="text-muted-foreground">{t('noResults')}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="text-left p-3 font-medium">{t('colName')}</th>
                <th className="text-left p-3 font-medium">{t('colEmail')}</th>
                <th className="text-left p-3 font-medium">{t('colStatus')}</th>
                <th className="text-left p-3 font-medium">{t('colSchoolVerified')}</th>
                <th className="text-left p-3 font-medium">{t('colCompleteness')}</th>
                <th className="p-3"></th>
              </tr>
            </thead>
            <tbody>
              {items.map((s) => (
                <tr key={s.userId} className="border-b hover:bg-muted/30">
                  <td className="p-3 font-medium">{s.fullName}</td>
                  <td className="p-3 text-muted-foreground">{s.email}</td>
                  <td className="p-3">
                    <span
                      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs ${
                        s.status === 'ACTIVE'
                          ? 'bg-green-100 text-green-800'
                          : s.status === 'SUSPENDED'
                          ? 'bg-red-100 text-red-800'
                          : 'bg-gray-100 text-gray-600'
                      }`}
                    >
                      {t(`status_${s.status.toLowerCase()}` as 'status_active')}
                    </span>
                  </td>
                  <td className="p-3 text-muted-foreground">
                    {s.schoolVerifiedAt
                      ? new Date(s.schoolVerifiedAt).toLocaleDateString(locale)
                      : '—'}
                  </td>
                  <td className="p-3">{s.completeness}%</td>
                  <td className="p-3 text-right">
                    <Link
                      href={`/${locale}/admin/students/${s.userId}`}
                      className="text-primary underline-offset-4 hover:underline text-sm"
                    >
                      {t('detailAction')}
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="mt-6 flex gap-2 justify-center">
          {Array.from({ length: totalPages }, (_, i) => i + 1).map((p) => (
            <Link
              key={p}
              href={`/${locale}/admin/students?${new URLSearchParams({
                ...(q ? { q } : {}),
                ...(status ? { status } : {}),
                page: String(p),
              })}`}
              className={`rounded px-3 py-1 text-sm ${
                p === page
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted hover:bg-muted/70'
              }`}
            >
              {p}
            </Link>
          ))}
        </div>
      )}
    </main>
  )
}
