import { getTranslations } from 'next-intl/server'
import Link from 'next/link'
import { headers } from 'next/headers'
import { requireAdmin } from '@/server/authz'
import { listPendingJobs } from '@/server/services/review-jobs'
import { formatKLDate } from '@/lib/format-date'

export default async function AdminJobsPage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  const ctx = await requireAdmin(await headers())
  const t = await getTranslations('adminJobs')
  const tJobs = await getTranslations('jobs')
  const jobs = await listPendingJobs(ctx)

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <h1 className="text-2xl font-bold mb-6">{t('title')}</h1>
      <h2 className="text-lg font-semibold mb-4">{t('pendingList')}</h2>

      {jobs.length === 0 ? (
        <p className="text-muted-foreground">{t('noPending')}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="text-left p-3 font-medium">{t('titleLabel')}</th>
                <th className="text-left p-3 font-medium">{t('companyLabel')}</th>
                <th className="text-left p-3 font-medium">{t('typeLabel')}</th>
                <th className="text-left p-3 font-medium">{t('submittedAtLabel')}</th>
                <th className="p-3"></th>
              </tr>
            </thead>
            <tbody>
              {jobs.map(job => (
                <tr key={job.id} className="border-b hover:bg-muted/30">
                  <td className="p-3 font-medium">{job.title}</td>
                  <td className="p-3 text-muted-foreground">{job.company.legalName}</td>
                  <td className="p-3 text-muted-foreground">
                    {tJobs(`type.${job.type}`)}
                  </td>
                  <td className="p-3 text-muted-foreground">
                    {formatKLDate(job.updatedAt, locale)}
                  </td>
                  <td className="p-3 text-right">
                    <Link
                      href={`/${locale}/admin/jobs/${job.id}`}
                      className="text-primary underline-offset-4 hover:underline text-sm"
                    >
                      {t('reviewAction')}
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
