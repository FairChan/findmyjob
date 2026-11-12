'use client'

import {
  BadgeCheck,
  Bell,
  Briefcase,
  Building2,
  FileText,
  Folder,
  Gift,
  LayoutDashboard,
  Mail,
  MailOpen,
  ReceiptText,
  Search,
  Send,
  Settings,
  ShieldCheck,
  UserRound,
  Users,
  UsersRound,
  type LucideIcon,
} from 'lucide-react'
import { Link, usePathname } from '@/i18n/navigation'
import { cn } from '@/lib/utils'

// Icons are chosen by name because a server layout cannot hand a component to this client one.
const ICONS = {
  dashboard: LayoutDashboard,
  search: Search,
  profile: UserRound,
  resume: FileText,
  applications: Send,
  invitations: MailOpen,
  notifications: Bell,
  invite: Gift,
  privacy: ShieldCheck,
  settings: Settings,
  jobs: Briefcase,
  talent: Users,
  folders: Folder,
  team: UsersRound,
  company: Building2,
  verification: BadgeCheck,
  billing: ReceiptText,
  mail: Mail,
} satisfies Record<string, LucideIcon>

export type AppNavIcon = keyof typeof ICONS

export interface AppNavItem {
  href: string
  label: string
  icon: AppNavIcon
  /** Match this path only, not the pages beneath it (for a section's home). */
  exact?: boolean
  /** Unread or pending count; hidden when zero. */
  count?: number
  /** Full accessible name when the count should be read out with the label. */
  ariaLabel?: string
}

interface AppNavProps {
  label: string
  items: AppNavItem[]
}

export function AppNav({ label, items }: AppNavProps) {
  const pathname = usePathname()

  return (
    <nav
      aria-label={label}
      className="flex gap-1 overflow-x-auto px-3 py-2 lg:flex-col lg:overflow-visible lg:px-3 lg:py-4"
    >
      {items.map(({ href, label: itemLabel, icon, exact, count = 0, ariaLabel }) => {
        const Icon = ICONS[icon]
        const active = exact ? pathname === href : pathname === href || pathname.startsWith(`${href}/`)
        return (
          <Link
            key={href}
            href={href}
            // Several workspace pages count a view or spend quota when rendered.
            prefetch={false}
            aria-label={ariaLabel}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'flex min-h-10 shrink-0 items-center gap-2.5 rounded-control px-3 text-sm transition-colors',
              active
                ? 'bg-muted font-medium text-foreground'
                : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground',
            )}
          >
            <Icon aria-hidden="true" className="size-4 shrink-0" strokeWidth={1.75} />
            {itemLabel}
            {count > 0 && (
              <span
                aria-hidden="true"
                className="ml-auto inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-brand px-1.5 text-[11px] font-medium text-brand-foreground"
              >
                {count > 99 ? '99+' : count}
              </span>
            )}
          </Link>
        )
      })}
    </nav>
  )
}
