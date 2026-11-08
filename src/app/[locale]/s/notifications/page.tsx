import { headers } from 'next/headers'
import Link from 'next/link'
import { getTranslations, getLocale } from 'next-intl/server'
import { requireStudent } from '@/server/authz'
import { listNotifications } from '@/server/services/notifications'
import { NotificationsClient } from '@/components/notifications/NotificationsClient'
import { MarkAllReadButton } from '@/components/notifications/MarkAllReadButton'
import { formatKLDate } from '@/lib/format-date'

export default async function NotificationsPage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  const t = await getTranslations('notifications')
  const detectedLocale = await getLocale()
  const { userId } = await requireStudent(await headers())

  const notifications = await listNotifications({ userId })
  const ids = notifications.map((n) => n.id)

  function notificationLabel(type: string): string {
    switch (type) {
      case 'talent.unlock':
        return t('talentUnlock')
      case 'company.verified':
        return t('companyVerified')
      case 'company.rejected':
        return t('companyRejected')
      case 'job.approved':
        return t('jobApproved')
      case 'job.rejected':
        return t('jobRejected')
      case 'application.status.changed':
        return t('applicationStatusChanged')
      case 'invitation.received':
        return t('invitationReceived')
      case 'invitation.accepted':
        return t('invitationAccepted')
      case 'invitation.declined':
        return t('invitationDeclined')
      case 'credits.granted':
        return t('creditsGranted')
      case 'credits.low':
        return t('creditsLow')
      case 'quota.exhausted':
        return t('quotaExhausted')
      case 'referral.qualified':
        return t('referralQualified')
      case 'system.alert':
        return t('systemAlert')
      default:
        return t('unknownType')
    }
  }

  const unreadCount = notifications.filter((n) => n.readAt === null).length

  return (
    <main id="main-content" className="container mx-auto max-w-2xl px-4 py-8">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="mb-1 text-2xl font-bold">{t('title')}</h1>
          <p className="text-sm text-muted-foreground">{t('subtitle')}</p>
        </div>
        {unreadCount > 0 && <MarkAllReadButton label={t('markAllRead')} />}
      </div>

      {notifications.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('empty')}</p>
      ) : (
        <ul className="divide-y rounded-md border">
          {notifications.map((n) => (
            <li
              key={n.id}
              className="flex items-start justify-between gap-4 px-4 py-3"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">{notificationLabel(n.type)}</span>
                  {n.readAt === null && (
                    <span className="rounded-full bg-primary px-1.5 py-0.5 text-[10px] font-medium text-primary-foreground">
                      {t('unread')}
                    </span>
                  )}
                </div>
                {n.type === 'talent.unlock' && (
                  <Link
                    href={`/${locale}/s/privacy`}
                    className="mt-1 text-xs text-muted-foreground underline-offset-2 hover:underline"
                  >
                    {t('privacyLink')}
                  </Link>
                )}
              </div>
              <span className="shrink-0 text-xs text-muted-foreground">
                {formatKLDate(n.createdAt, detectedLocale)}
              </span>
            </li>
          ))}
        </ul>
      )}

      {/* Mark displayed notifications as read after page renders */}
      <NotificationsClient ids={ids} />
    </main>
  )
}
