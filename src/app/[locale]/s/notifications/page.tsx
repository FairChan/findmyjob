import { headers } from 'next/headers'
import Link from 'next/link'
import { getTranslations, getLocale } from 'next-intl/server'
import { requireStudent } from '@/server/authz'
import { listNotifications } from '@/server/services/notifications'
import { NotificationsClient } from '@/components/notifications/NotificationsClient'
import { MarkAllReadButton } from '@/components/notifications/MarkAllReadButton'
import { formatKLDate } from '@/lib/format-date'
import { WorkspacePage } from '@/components/layout/workspace-page'
import { Badge } from '@/components/ui/badge'
import { EmptyState } from '@/components/ui/empty-state'
import { Row, RowList } from '@/components/ui/row-list'

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
    <WorkspacePage
      title={t('title')}
      lead={t('subtitle')}
      width="list"
      actions={unreadCount > 0 ? <MarkAllReadButton label={t('markAllRead')} /> : undefined}
    >
      {notifications.length === 0 ? (
        <EmptyState title={t('empty')} />
      ) : (
        <RowList>
          {notifications.map((n) => (
            <Row key={n.id} className="items-start">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium">{notificationLabel(n.type)}</span>
                  {n.readAt === null && <Badge tone="brand">{t('unread')}</Badge>}
                </div>
                {n.type === 'talent.unlock' && (
                  <Link
                    href={`/${locale}/s/privacy`}
                    className="mt-1 inline-flex min-h-6 items-center text-sm text-brand underline underline-offset-4"
                  >
                    {t('privacyLink')}
                  </Link>
                )}
              </div>
              <span className="shrink-0 pt-0.5 text-xs text-muted-foreground">
                {formatKLDate(n.createdAt, detectedLocale)}
              </span>
            </Row>
          ))}
        </RowList>
      )}

      {/* Mark displayed notifications as read after page renders */}
      <NotificationsClient ids={ids} />
    </WorkspacePage>
  )
}
