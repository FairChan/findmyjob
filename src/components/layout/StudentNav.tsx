import { getTranslations } from 'next-intl/server'
import { Link } from '@/i18n/navigation'
import { db } from '@/server/db'

interface Props {
  userId: string
  locale: string
}

export default async function StudentNav({ userId, locale }: Props) {
  const t = await getTranslations('nav')
  const tInv = await getTranslations('invitations')

  const [unreadCount, pendingInvitationCount] = await Promise.all([
    db.notification.count({ where: { userId, readAt: null } }),
    db.studentProfile.findUnique({ where: { userId }, select: { id: true } }).then(async (p) => {
      if (!p) return 0
      return db.invitation.count({ where: { studentId: p.id, status: 'SENT' } })
    }),
  ])

  return (
    <nav
      aria-label={t('notifications')}
      className="border-b bg-muted/40"
    >
      <div className="container mx-auto flex max-w-5xl items-center gap-4 overflow-x-auto px-4 py-2 text-sm">
        <Link
          href="/s/profile"
          className="shrink-0 font-medium text-muted-foreground hover:text-foreground transition-colors"
        >
          {t('myProfile')}
        </Link>
        <Link
          href="/s/invitations"
          className="relative shrink-0 font-medium text-muted-foreground hover:text-foreground transition-colors"
          aria-label={
            pendingInvitationCount > 0
              ? `${tInv('navInvitations')} (${pendingInvitationCount})`
              : tInv('navInvitations')
          }
        >
          {tInv('navInvitations')}
          {pendingInvitationCount > 0 && (
            <span
              aria-hidden="true"
              className="ml-1.5 inline-flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-medium text-destructive-foreground"
            >
              {pendingInvitationCount > 99 ? '99+' : pendingInvitationCount}
            </span>
          )}
        </Link>
        <Link
          href="/s/notifications"
          className="relative shrink-0 font-medium text-muted-foreground hover:text-foreground transition-colors"
          aria-label={
            unreadCount > 0
              ? `${t('notifications')} (${unreadCount})`
              : t('notifications')
          }
        >
          {t('notifications')}
          {unreadCount > 0 && (
            <span
              aria-hidden="true"
              className="ml-1.5 inline-flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-primary px-1 text-[10px] font-medium text-primary-foreground"
            >
              {unreadCount > 99 ? '99+' : unreadCount}
            </span>
          )}
        </Link>
        <Link
          href="/s/privacy"
          className="shrink-0 font-medium text-muted-foreground hover:text-foreground transition-colors"
        >
          {t('privacy')}
        </Link>
      </div>
    </nav>
  )
}
