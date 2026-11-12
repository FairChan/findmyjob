import { getTranslations } from 'next-intl/server'
import { db } from '@/server/db'
import { AppNav, type AppNavItem } from './app-nav'

interface Props {
  userId: string
  locale: string
}

export default async function StudentNav({ userId }: Props) {
  const t = await getTranslations('nav')
  const tApp = await getTranslations('appNav')
  const tInv = await getTranslations('invitations')

  const [unreadCount, pendingInvitationCount] = await Promise.all([
    db.notification.count({ where: { userId, readAt: null } }),
    db.studentProfile.findUnique({ where: { userId }, select: { id: true } }).then(async (p) => {
      if (!p) return 0
      return db.invitation.count({ where: { studentId: p.id, status: 'SENT' } })
    }),
  ])

  const items: AppNavItem[] = [
    { href: '/s', label: tApp('dashboard'), icon: 'dashboard', exact: true },
    { href: '/jobs', label: tApp('findJobs'), icon: 'search' },
    { href: '/s/profile', label: t('myProfile'), icon: 'profile' },
    { href: '/s/resume', label: tApp('resume'), icon: 'resume' },
    { href: '/s/applications', label: t('myApplications'), icon: 'applications' },
    {
      href: '/s/invitations',
      label: tInv('navInvitations'),
      icon: 'invitations',
      count: pendingInvitationCount,
      ariaLabel:
        pendingInvitationCount > 0
          ? `${tInv('navInvitations')} (${pendingInvitationCount})`
          : undefined,
    },
    {
      href: '/s/notifications',
      label: t('notifications'),
      icon: 'notifications',
      count: unreadCount,
      ariaLabel: unreadCount > 0 ? `${t('notifications')} (${unreadCount})` : undefined,
    },
    { href: '/s/invite', label: tApp('inviteFriends'), icon: 'invite' },
    { href: '/s/privacy', label: t('privacy'), icon: 'privacy' },
    { href: '/s/settings', label: tApp('settings'), icon: 'settings' },
  ]

  return <AppNav label={t('studentNavigation')} items={items} />
}
