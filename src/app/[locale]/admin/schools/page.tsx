import Link from 'next/link'
import { headers } from 'next/headers'
import { getTranslations } from 'next-intl/server'
import { requireAdmin } from '@/server/authz'
import { listSchools } from '@/server/services/admin-schools-partners'

export default async function AdminSchoolsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>
  searchParams: Promise<{ q?: string; active?: string }>
}) {
  const { locale } = await params
  const sp = await searchParams
  const ctx = await requireAdmin(await headers())
  const t = await getTranslations('adminSchools')

  const activeFilter =
    sp.active === 'true' ? true : sp.active === 'false' ? false : undefined

  const schools = await listSchools(ctx, {
    q: sp.q,
    active: activeFilter,
  })

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">{t('title')}</h1>
        <Link
          href={`/${locale}/admin/schools/new`}
          className="rounded-control bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          {t('createBtn')}
        </Link>
      </div>

      <form method="GET" className="flex gap-2 mb-6">
        <input
          type="text"
          name="q"
          defaultValue={sp.q}
          placeholder={t('searchPlaceholder')}
          className="flex-1 rounded-control border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
        />
        <button
          type="submit"
          className="rounded-control bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          {t('searchBtn')}
        </button>
      </form>

      <p className="mb-4 text-sm text-muted-foreground">
        {t('totalCount', { count: schools.length })}
      </p>

      {schools.length === 0 ? (
        <p className="text-muted-foreground">{t('noResults')}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="text-left p-3 font-medium">{t('colName')}</th>
                <th className="text-left p-3 font-medium">{t('colEmailDomains')}</th>
                <th className="text-left p-3 font-medium">{t('colPartner')}</th>
                <th className="text-left p-3 font-medium">{t('colStudents')}</th>
                <th className="text-left p-3 font-medium">{t('colActive')}</th>
                <th className="p-3"></th>
              </tr>
            </thead>
            <tbody>
              {schools.map((s) => (
                <tr key={s.id} className="border-b hover:bg-muted/30">
                  <td className="p-3 font-medium">
                    {s.nameZh}
                    <span className="ml-1 text-xs text-muted-foreground">/ {s.nameEn}</span>
                  </td>
                  <td className="p-3 text-muted-foreground">
                    {s.emailDomains.slice(0, 2).join(', ')}
                    {s.emailDomains.length > 2 && ` +${s.emailDomains.length - 2}`}
                  </td>
                  <td className="p-3">
                    {s.isPartner ? t('yes') : t('no')}
                  </td>
                  <td className="p-3">{s.studentCount}</td>
                  <td className="p-3">
                    <span
                      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs ${
                        s.active
                          ? 'bg-success-muted text-success'
                          : 'bg-muted text-muted-foreground'
                      }`}
                    >
                      {s.active ? t('statusActive') : t('statusInactive')}
                    </span>
                  </td>
                  <td className="p-3 text-right">
                    <Link
                      href={`/${locale}/admin/schools/${s.id}`}
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
    </div>
  )
}
