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
  let userId: string
  try {
    const ctx = await requireAdmin(await headers())
    userId = ctx.userId
  } catch (err) {
    if (err instanceof ForbiddenError) {
      redirect(`/${locale}/login`)
    }
    throw err
  }

  const t = await getTranslations('adminLayout')

  const [pendingCompanies, pendingJobs, unreadCount] = await Promise.all([
    db.company.count({ where: { verificationStatus: 'PENDING' } }),
    db.job.count({ where: { status: 'PENDING_REVIEW' } }),
    db.notification.count({ where: { userId, readAt: null } }),
  ])
  const pendingCount = pendingCompanies + pendingJobs
  const bellLabel = unreadCount > 0
    ? t('bellLabelWithCount', { count: unreadCount > 99 ? '99+' : unreadCount })
    : t('bellLabel')

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
          notificationsLabel={t('navNotifications')}
          settingsLabel={t('navSettings')}
          pendingCount={pendingCount}
        />
      </aside>
      <div className="min-w-0 flex-1">
        <header className="flex h-14 items-center justify-between border-b border-gray-200 bg-white px-4 md:px-6">
          <span className="text-sm text-gray-500">{t('adminLabel')}</span>
          <div className="flex items-center gap-4">
            <Link
              href={`/${locale}/admin/notifications`}
              aria-label={bellLabel}
              className="relative flex items-center gap-1 rounded-md px-2 py-1 text-sm text-gray-500 hover:bg-gray-100 hover:text-gray-700 transition-colors"
            >
              <span aria-hidden="true">🔔</span>
              {unreadCount > 0 && (
                <span
                  aria-hidden="true"
                  className="inline-flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-primary px-1 text-[10px] font-medium text-primary-foreground"
                >
                  {unreadCount > 99 ? '99+' : unreadCount}
                </span>
              )}
            </Link>
            <Link href={`/${locale}`} className="text-sm text-gray-500 hover:text-[var(--color-brand-500,#3b82f6)]">
              {t('returnToFront')}
            </Link>
          </div>
        </header>
        {children}
      </div>
    </div>
  )
}
