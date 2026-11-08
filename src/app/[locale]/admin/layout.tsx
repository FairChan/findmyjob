import type { ReactNode } from 'react'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { headers } from 'next/headers'
import { getTranslations } from 'next-intl/server'
import { requireAdmin } from '@/server/authz'
import { ForbiddenError } from '@/server/errors'
import { db } from '@/server/db'
import { AdminNavLinks } from '@/components/admin/admin-nav-links'

export default async function AdminLayout({
  children,
  params,
}: {
  children: ReactNode
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  try {
    await requireAdmin(await headers())
  } catch (err) {
    if (err instanceof ForbiddenError) {
      redirect(`/${locale}/login`)
    }
    throw err
  }

  const t = await getTranslations('adminLayout')

  const [pendingCompanies, pendingJobs] = await Promise.all([
    db.company.count({ where: { verificationStatus: 'PENDING' } }),
    db.job.count({ where: { status: 'PENDING_REVIEW' } }),
  ])
  const pendingCount = pendingCompanies + pendingJobs

  return (
    <div className="min-h-screen bg-[#f5f6fa] lg:flex">
      <aside className="shrink-0 bg-[#1f2433] text-white/75 lg:sticky lg:top-0 lg:h-screen lg:w-56">
        <div className="flex h-14 items-center gap-2 px-5 font-semibold text-white">
          {t('title')}
        </div>
        <AdminNavLinks
          locale={locale}
          dashboardLabel={t('navDashboard')}
          studentsLabel={t('navStudents')}
          companiesLabel={t('navCompanies')}
          jobsLabel={t('navJobs')}
          schoolsLabel={t('navSchools')}
          partnersLabel={t('navPartners')}
          pendingCount={pendingCount}
        />
      </aside>
      <div className="min-w-0 flex-1">
        <header className="flex h-14 items-center justify-between border-b border-gray-200 bg-white px-4 md:px-6">
          <span className="text-sm text-gray-500">{t('adminLabel')}</span>
          <Link href={`/${locale}`} className="text-sm text-gray-500 hover:text-[var(--color-brand-500,#3b82f6)]">
            {t('returnToFront')}
          </Link>
        </header>
        {children}
      </div>
    </div>
  )
}
