import type { ReactNode } from 'react'
import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { headers } from 'next/headers'
import { getTranslations } from 'next-intl/server'
import { requireAdmin } from '@/server/authz'
import { ForbiddenError, TwoFactorRequiredError } from '@/server/errors'
import { db } from '@/server/db'
import { Bell } from 'lucide-react'
import type { Locale } from '@/i18n/routing'
import { AdminNavLinks } from '@/components/admin/admin-nav-links'
import SignOutButton from '@/components/auth/SignOutButton'
import LocaleSwitcher from '@/components/layout/locale-switcher'
import { Wordmark } from '@/components/layout/wordmark'

export const metadata: Metadata = {
  title: { default: 'Admin · FindMYJob', template: '%s · Admin · FindMYJob' },
}

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
    if (err instanceof TwoFactorRequiredError) {
      redirect(`/${locale}/two-factor/setup`)
    }
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
    <div className="min-h-screen flex-1 overflow-x-hidden bg-background lg:flex">
      <aside className="shrink-0 border-b bg-muted lg:w-60 lg:border-b-0 lg:border-r">
        <div className="lg:sticky lg:top-0 lg:max-h-screen lg:overflow-y-auto">
        <div className="flex h-12 items-center px-5 text-[19px]">
          <span className="sr-only">{t('title')}</span>
          <span aria-hidden="true">
            <Wordmark />
          </span>
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
          dataRequestsLabel={t('navDataRequests')}
          auditLabel={t('navAudit')}
          growthLabel={t('navGrowth')}
          reportsLabel={t('navReports')}
          synonymsLabel={t('navSynonyms')}
          articlesLabel={t('navArticles')}
          plansLabel={t('navPlans')}
          ordersLabel={t('navOrders')}
          pendingCount={pendingCount}
        />
        </div>
      </aside>
      <div className="min-w-0 flex-1">
        <header className="sticky top-0 z-30 flex h-12 items-center justify-between gap-3 border-b border-border/70 bg-background/80 px-4 backdrop-blur-xl backdrop-saturate-150 md:px-6">
          <span className="truncate text-xs text-muted-foreground">{t('adminLabel')}</span>
          <div className="flex shrink-0 items-center gap-2">
            <Link
              href={`/${locale}/admin/notifications`}
              aria-label={bellLabel}
              className="relative inline-flex h-8 min-w-8 items-center justify-center gap-1 rounded-full px-2 text-foreground/80 transition-colors hover:bg-muted hover:text-foreground"
            >
              <Bell aria-hidden="true" className="size-4" strokeWidth={1.75} />
              {unreadCount > 0 && (
                <span
                  aria-hidden="true"
                  className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-brand px-1.5 text-[11px] font-medium text-brand-foreground"
                >
                  {unreadCount > 99 ? '99+' : unreadCount}
                </span>
              )}
            </Link>
            <Link
              href={`/${locale}`}
              className="hidden min-h-8 items-center rounded-full px-3 text-[13px] text-foreground/80 transition-colors hover:text-foreground sm:inline-flex"
            >
              {t('returnToFront')}
            </Link>
            <LocaleSwitcher currentLocale={locale as Locale} />
            <SignOutButton compact />
          </div>
        </header>
        <main id="main-content">{children}</main>
      </div>
    </div>
  )
}
