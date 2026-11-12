import Link from 'next/link'
import { headers } from 'next/headers'
import { getTranslations } from 'next-intl/server'
import { requireAdmin } from '@/server/authz'
import { listPartners } from '@/server/services/admin-schools-partners'

export default async function AdminPartnersPage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  const ctx = await requireAdmin(await headers())
  const t = await getTranslations('adminPartners')

  const partners = await listPartners(ctx)

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">{t('title')}</h1>
        <Link
          href={`/${locale}/admin/partners/new`}
          className="rounded-control bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          {t('createBtn')}
        </Link>
      </div>

      {partners.length === 0 ? (
        <p className="text-muted-foreground">{t('noResults')}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="text-left p-3 font-medium">{t('colName')}</th>
                <th className="text-left p-3 font-medium">{t('colType')}</th>
                <th className="text-left p-3 font-medium">{t('colShowOnHome')}</th>
                <th className="text-left p-3 font-medium">{t('colSortOrder')}</th>
                <th className="p-3"></th>
              </tr>
            </thead>
            <tbody>
              {partners.map((p) => (
                <tr key={p.id} className="border-b hover:bg-muted/30">
                  <td className="p-3 font-medium">
                    {p.name}
                    {p.nameEn && (
                      <span className="ml-1 text-xs text-muted-foreground">/ {p.nameEn}</span>
                    )}
                  </td>
                  <td className="p-3 text-muted-foreground">
                    {t(`type${p.type}` as 'typeSCHOOL')}
                  </td>
                  <td className="p-3">
                    <span
                      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs ${
                        p.showOnHome
                          ? 'bg-success-muted text-success'
                          : 'bg-muted text-muted-foreground'
                      }`}
                    >
                      {p.showOnHome ? t('yes') : t('no')}
                    </span>
                  </td>
                  <td className="p-3 text-muted-foreground">{p.sortOrder}</td>
                  <td className="p-3 text-right">
                    <Link
                      href={`/${locale}/admin/partners/${p.id}`}
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
