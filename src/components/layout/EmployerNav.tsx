import { getTranslations } from 'next-intl/server'
import { db } from '@/server/db'
import { AppNav, type AppNavItem } from './app-nav'

interface Props {
  userId: string
}

export default async function EmployerNav({ userId }: Props) {
  const t = await getTranslations('employerLayout')
  const tApp = await getTranslations('appNav')
  const tDash = await getTranslations('employerDashboard')

  // Membership only decides which links to show. Every page still enforces its own access.
  const [unreadCount, member] = await Promise.all([
    db.notification.count({ where: { userId, readAt: null } }),
    db.companyMember.findFirst({ where: { userId }, select: { role: true } }),
  ])
  const isAdminOrOwner = member?.role === 'OWNER' || member?.role === 'ADMIN'

  const dashboard: AppNavItem = { href: '/e', label: tApp('dashboard'), icon: 'dashboard', exact: true }
  const notifications: AppNavItem = {
    href: '/e/notifications',
    label: t('bellLabel'),
    icon: 'notifications',
    count: unreadCount,
    ariaLabel:
      unreadCount > 0
        ? t('bellLabelWithCount', { count: unreadCount > 99 ? '99+' : unreadCount })
        : undefined,
  }

  // No company yet: onboarding or accepting an invitation is the only thing to do.
  if (!member) {
    return <AppNav label={tApp('employerNavigation')} items={[dashboard, notifications]} />
  }

  const items: AppNavItem[] = [
    dashboard,
    { href: '/e/jobs', label: tApp('jobs'), icon: 'jobs' },
    { href: '/e/talent', label: tApp('talent'), icon: 'talent' },
    { href: '/e/folders', label: tApp('folders'), icon: 'folders' },
    { href: '/e/invitations', label: tApp('sentInvitations'), icon: 'applications' },
    notifications,
    { href: '/e/team', label: tDash('linkTeam'), icon: 'team' },
  ]
  if (isAdminOrOwner) {
    items.push(
      { href: '/e/company', label: tDash('linkCompany'), icon: 'company' },
      { href: '/e/verification', label: tDash('linkVerification'), icon: 'verification' },
    )
  }
  if (member.role === 'OWNER') {
    items.push({ href: '/e/billing', label: tDash('linkBilling'), icon: 'billing' })
  }

  return <AppNav label={tApp('employerNavigation')} items={items} />
}
