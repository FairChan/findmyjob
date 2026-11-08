'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { LayoutDashboard, BadgeCheck, Briefcase, Bell, FileText } from 'lucide-react'

interface AdminNavLinksProps {
  locale: string
  dashboardLabel: string
  companiesLabel: string
  jobsLabel: string
  notificationsLabel: string
  dataRequestsLabel: string
  pendingCount: number
}

const NAV_ITEMS = [
  { key: 'dashboard', href: (locale: string) => `/${locale}/admin`, icon: LayoutDashboard, end: true },
  { key: 'companies', href: (locale: string) => `/${locale}/admin/companies`, icon: BadgeCheck, end: false },
  { key: 'jobs', href: (locale: string) => `/${locale}/admin/jobs`, icon: Briefcase, end: false },
  { key: 'notifications', href: (locale: string) => `/${locale}/admin/notifications`, icon: Bell, end: false },
  { key: 'dataRequests', href: (locale: string) => `/${locale}/admin/data-requests`, icon: FileText, end: false },
] as const

export function AdminNavLinks({
  locale,
  dashboardLabel,
  companiesLabel,
  jobsLabel,
  notificationsLabel,
  dataRequestsLabel,
  pendingCount,
}: AdminNavLinksProps) {
  const pathname = usePathname()

  const labels: Record<string, string> = {
    dashboard: dashboardLabel,
    companies: companiesLabel,
    jobs: jobsLabel,
    notifications: notificationsLabel,
    dataRequests: dataRequestsLabel,
  }

  return (
    <nav className="flex gap-1 overflow-x-auto px-3 pb-3 lg:flex-col" aria-label="Admin navigation">
      {NAV_ITEMS.map(({ key, href, icon: Icon, end }) => {
        const to = href(locale)
        const isActive = end ? pathname === to || pathname === `${to}/` : pathname.startsWith(`${to}/`) || pathname === to
        return (
          <Link
            key={key}
            href={to}
            aria-current={isActive ? 'page' : undefined}
            className={`flex shrink-0 items-center gap-2.5 rounded-lg px-3 py-2.5 text-sm ${
              isActive
                ? 'bg-[var(--color-brand-500,#3b82f6)] text-white'
                : 'text-white/75 hover:bg-white/10 hover:text-white'
            }`}
          >
            <Icon className="size-4 shrink-0" />
            {labels[key]}
            {key === 'dashboard' && pendingCount > 0 && (
              <span className="ml-auto rounded-full bg-red-500 px-1.5 text-xs text-white">
                {pendingCount}
              </span>
            )}
          </Link>
        )
      })}
    </nav>
  )
}
