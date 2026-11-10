'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { LayoutDashboard, BadgeCheck, Briefcase, Users, School, Handshake, Bell, Settings, FileText, ClipboardList, TrendingUp, Flag, Languages, ShieldCheck } from 'lucide-react'

interface AdminNavLinksProps {
  locale: string
  dashboardLabel: string
  companiesLabel: string
  jobsLabel: string
  studentsLabel: string
  schoolsLabel: string
  partnersLabel: string
  notificationsLabel: string
  settingsLabel: string
  dataRequestsLabel: string
  auditLabel: string
  growthLabel: string
  reportsLabel: string
  synonymsLabel: string
  articlesLabel: string
  plansLabel: string
  ordersLabel: string
  pendingCount: number
}

const NAV_ITEMS = [
  { key: 'dashboard', href: (locale: string) => `/${locale}/admin`, icon: LayoutDashboard, end: true },
  { key: 'students', href: (locale: string) => `/${locale}/admin/students`, icon: Users, end: false },
  { key: 'companies', href: (locale: string) => `/${locale}/admin/companies`, icon: BadgeCheck, end: false },
  { key: 'jobs', href: (locale: string) => `/${locale}/admin/jobs`, icon: Briefcase, end: false },
  { key: 'schools', href: (locale: string) => `/${locale}/admin/schools`, icon: School, end: false },
  { key: 'partners', href: (locale: string) => `/${locale}/admin/partners`, icon: Handshake, end: false },
  { key: 'notifications', href: (locale: string) => `/${locale}/admin/notifications`, icon: Bell, end: false },
  { key: 'settings', href: (locale: string) => `/${locale}/admin/settings`, icon: Settings, end: false },
  { key: 'dataRequests', href: (locale: string) => `/${locale}/admin/data-requests`, icon: FileText, end: false },
  { key: 'audit', href: (locale: string) => `/${locale}/admin/audit`, icon: ClipboardList, end: false },
  { key: 'growth', href: (locale: string) => `/${locale}/admin/growth`, icon: TrendingUp, end: false },
  { key: 'reports', href: (locale: string) => `/${locale}/admin/reports`, icon: Flag, end: false },
  { key: 'synonyms', href: (locale: string) => `/${locale}/admin/synonyms`, icon: Languages, end: false },
  { key: 'articles', href: (locale: string) => `/${locale}/admin/articles`, icon: ShieldCheck, end: false },
  { key: 'plans', href: (locale: string) => `/${locale}/admin/plans`, icon: ClipboardList, end: false },
  { key: 'orders', href: (locale: string) => `/${locale}/admin/orders`, icon: FileText, end: false },
] as const

export function AdminNavLinks({
  locale,
  dashboardLabel,
  companiesLabel,
  jobsLabel,
  studentsLabel,
  schoolsLabel,
  partnersLabel,
  notificationsLabel,
  settingsLabel,
  dataRequestsLabel,
  auditLabel,
  growthLabel,
  reportsLabel,
  synonymsLabel,
  articlesLabel,
  plansLabel,
  ordersLabel,
  pendingCount,
}: AdminNavLinksProps) {
  const pathname = usePathname()

  const labels: Record<string, string> = {
    dashboard: dashboardLabel,
    students: studentsLabel,
    companies: companiesLabel,
    jobs: jobsLabel,
    schools: schoolsLabel,
    partners: partnersLabel,
    notifications: notificationsLabel,
    settings: settingsLabel,
    dataRequests: dataRequestsLabel,
    audit: auditLabel,
    growth: growthLabel,
    reports: reportsLabel,
    synonyms: synonymsLabel,
    articles: articlesLabel,
    plans: plansLabel,
    orders: ordersLabel,
  }

  return (
    <nav className="flex gap-1 overflow-x-auto px-3 pb-3 lg:flex-col lg:overflow-visible" aria-label="Admin navigation">
      {NAV_ITEMS.map(({ key, href, icon: Icon, end }) => {
        const to = href(locale)
        const isActive = end ? pathname === to || pathname === `${to}/` : pathname.startsWith(`${to}/`) || pathname === to
        return (
          <Link
            key={key}
            href={to}
            aria-current={isActive ? 'page' : undefined}
            className={`flex min-h-10 shrink-0 items-center gap-2.5 rounded-control px-3 text-sm transition-colors ${
              isActive
                ? 'bg-background font-medium text-foreground shadow-sm'
                : 'text-muted-foreground hover:bg-background/60 hover:text-foreground'
            }`}
          >
            <Icon aria-hidden="true" className="size-4 shrink-0" strokeWidth={1.75} />
            {labels[key]}
            {key === 'dashboard' && pendingCount > 0 && (
              <span className="ml-auto inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-destructive px-1.5 text-[11px] font-medium text-destructive-foreground">
                {pendingCount}
              </span>
            )}
          </Link>
        )
      })}
    </nav>
  )
}
