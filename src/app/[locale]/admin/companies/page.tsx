import { getTranslations } from 'next-intl/server'
import Link from 'next/link'
import { headers } from 'next/headers'
import { requireAdmin } from '@/server/authz'
import { listPendingVerifications } from '@/server/services/review-company'

export default async function AdminCompaniesPage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  const ctx = await requireAdmin(await headers())
  const t = await getTranslations('adminCompanies')
  const companies = await listPendingVerifications(ctx)

  return (
    <main id="main-content" className="p-6 max-w-5xl mx-auto">
      <h1 className="text-2xl font-bold mb-6">{t('title')}</h1>
      <h2 className="text-lg font-semibold mb-4">{t('pendingList')}</h2>

      {companies.length === 0 ? (
        <p className="text-muted-foreground">{t('noPending')}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="text-left p-3 font-medium">{t('companyNameLabel')}</th>
                <th className="text-left p-3 font-medium">{t('submittedAtLabel')}</th>
                <th className="text-left p-3 font-medium">{t('statusPending')}</th>
                <th className="p-3"></th>
              </tr>
            </thead>
            <tbody>
              {companies.map(company => {
                const cv = company.verifications[0]
                return (
                  <tr key={company.id} className="border-b hover:bg-muted/30">
                    <td className="p-3 font-medium">{company.legalName}</td>
                    <td className="p-3 text-muted-foreground">
                      {cv ? new Date(cv.createdAt).toLocaleDateString(locale) : '—'}
                    </td>
                    <td className="p-3">
                      <span className="inline-flex items-center rounded-full bg-yellow-100 px-2 py-0.5 text-xs text-yellow-800">
                        {t('statusPending')}
                      </span>
                    </td>
                    <td className="p-3 text-right">
                      <Link
                        href={`/${locale}/admin/companies/${company.id}`}
                        className="text-primary underline-offset-4 hover:underline text-sm"
                      >
                        {t('reviewAction')}
                      </Link>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </main>
  )
}
