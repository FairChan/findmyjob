import type { Metadata } from 'next'
import Link from 'next/link'
import { headers } from 'next/headers'
import { getTranslations } from 'next-intl/server'
import { requireAdmin } from '@/server/authz'
import { getDashboardStats } from '@/server/services/admin-dashboard'
import { WeeklyBars } from '@/components/admin/weekly-bars'

export const metadata: Metadata = {
  robots: { index: false, follow: false },
}

export default async function AdminDashboardPage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  const ctx = await requireAdmin(await headers())
  const t = await getTranslations('adminDashboard')

  const stats = await getDashboardStats(ctx)

  const signupRatio = stats.signupCap > 0 ? stats.studentCount / stats.signupCap : 0
  const signupPct = Math.min(100, Math.round(signupRatio * 100))

  const metricCards = [
    { label: t('statPendingCompanies'), value: stats.pendingCompanyCount, href: `/${locale}/admin/companies?status=PENDING` },
    { label: t('statPendingJobs'), value: stats.pendingJobCount, href: `/${locale}/admin/jobs` },
    { label: t('statPublishedJobs'), value: stats.publishedJobCount, href: undefined },
    { label: t('statVerifiedCompanies'), value: stats.verifiedCompanyCount, href: undefined },
    { label: t('statStudents'), value: stats.studentCount, href: undefined },
    { label: t('statCompleteness'), value: stats.completenessGe60, href: undefined },
    { label: t('statApplications'), value: stats.applicationCount, href: undefined },
    { label: t('statUnlocks'), value: stats.unlockCount, href: undefined },
    { label: t('statCreditsGranted'), value: stats.creditsGranted, href: undefined },
    { label: t('statCreditsConsumed'), value: stats.creditsConsumed, href: undefined },
  ]

  return (
    <main id="main-content" className="p-4 md:p-6 space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <h1 className="text-xl font-semibold">{t('title')}</h1>
      </div>

      {/* Metric cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {metricCards.map((card) => (
          <div
            key={card.label}
            className="rounded-xl border border-gray-200 bg-white p-4"
          >
            <p className="text-xs text-gray-500 mb-1">{card.label}</p>
            <p className="text-2xl font-semibold tabular-nums">{card.value.toLocaleString()}</p>
            {card.href && (
              <Link href={card.href} className="text-xs text-[var(--color-brand-500,#3b82f6)] mt-1 inline-block">
                {t('actionReview')} →
              </Link>
            )}
          </div>
        ))}
      </div>

      {/* Weekly chart + signup progress */}
      <div className="grid gap-5 lg:grid-cols-2">
        <WeeklyBars
          title={t('weeklyRegistrations')}
          data={stats.weeklyRegistrations}
        />
        {/* Signup progress */}
        <div className="rounded-xl border border-gray-200 bg-white p-5">
          <p className="font-semibold">{t('signupProgress')}</p>
          <p className="mt-1 text-sm text-gray-500">{t('signupProgressDesc')}</p>
          <div className="mt-4">
            <div className="flex justify-between text-sm mb-1.5">
              <span className="text-gray-600">{stats.studentCount.toLocaleString()} {t('signupUnit')}</span>
              <span className="tabular-nums text-gray-900">
                {t('signupCapLabel', { cap: stats.signupCap.toLocaleString() })}
              </span>
            </div>
            <div className="h-3 w-full rounded-full bg-gray-100">
              <div
                className={`h-full rounded-full transition-all ${
                  signupPct >= 90 ? 'bg-amber-500' : 'bg-[var(--color-brand-500,#3b82f6)]'
                }`}
                style={{ width: `${signupPct}%` }}
              />
            </div>
            <p className="mt-1.5 text-sm text-gray-500 tabular-nums">{signupPct}%</p>
          </div>
        </div>
      </div>

      {/* School distribution */}
      <div className="rounded-xl border border-gray-200 bg-white p-5">
        <p className="font-semibold">{t('schoolDistribution')}</p>
        {stats.schoolDistribution.length === 0 ? (
          <p className="mt-4 text-sm text-gray-400">{t('noSchoolData')}</p>
        ) : (
          <div className="mt-4 space-y-2.5">
            {(() => {
              const maxCount = Math.max(...stats.schoolDistribution.map((s) => s.count), 1)
              return stats.schoolDistribution.map((school) => (
                <div key={school.schoolNameZh} className="flex items-center gap-3 text-sm">
                  <span className="w-28 shrink-0 truncate text-gray-600" title={school.schoolNameZh}>
                    {school.schoolNameZh}
                  </span>
                  <div className="h-3 flex-1 rounded bg-gray-100">
                    <div
                      className="h-full rounded bg-[var(--color-brand-500,#3b82f6)]"
                      style={{ width: `${(school.count / maxCount) * 100}%` }}
                    />
                  </div>
                  <span className="w-8 text-right tabular-nums text-gray-500">{school.count}</span>
                </div>
              ))
            })()}
          </div>
        )}
      </div>
    </main>
  )
}
