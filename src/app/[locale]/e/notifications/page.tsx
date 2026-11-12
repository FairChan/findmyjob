import { headers } from 'next/headers'
import { getTranslations, getLocale } from 'next-intl/server'
import { requireCompanyMember } from '@/server/authz'
import { listNotifications } from '@/server/services/notifications'
import { NotificationsClient } from '@/components/notifications/NotificationsClient'
import { MarkAllReadButton } from '@/components/notifications/MarkAllReadButton'
import { formatKLDate, formatKLDateTime } from '@/lib/format-date'
import { WorkspacePage } from '@/components/layout/workspace-page'
import { Badge } from '@/components/ui/badge'
import { EmptyState } from '@/components/ui/empty-state'
import { Row, RowList } from '@/components/ui/row-list'

function expiryDate(payload: Record<string, unknown>): string | null {
  const value = payload.endsAt
  if (typeof value !== 'string') return null
  const date = new Date(value)
  return Number.isFinite(date.getTime()) && date.toISOString() === value ? value : null
}

export default async function EmployerNotificationsPage() {
  const t = await getTranslations('notifications')
  const detectedLocale = await getLocale()
  const { userId, role } = await requireCompanyMember('RECRUITER', await headers())

  const notifications = await listNotifications({ userId })
  const ids = notifications.map((n) => n.id)
  const unreadCount = notifications.filter((n) => n.readAt === null).length

  function notificationLabel(type: string): string {
    switch (type) {
      case 'company.verified':
        return t('companyVerified')
      case 'company.rejected':
        return t('companyRejected')
      case 'job.approved':
        return t('jobApproved')
      case 'job.rejected':
        return t('jobRejected')
      case 'job.application.new':
        return t('applicationNew')
      case 'order.confirmed':
        return t('orderConfirmed')
      case 'subscription.expiring':
        return t('subscriptionExpiring')
      case 'invitation.accepted':
        return t('invitationAccepted')
      case 'invitation.declined':
        return t('invitationDeclined')
      case 'credits.granted':
        return t('creditsGranted')
      case 'credits.low':
        return t('creditsLow')
      case 'talent.unlock':
        return t('talentUnlock')
      case 'system.alert':
        return t('systemAlert')
      default:
        return t('unknownType')
    }
  }

  return (
    <WorkspacePage
      title={t('title')}
      lead={t('subtitleEmployer')}
      width="list"
      actions={unreadCount > 0 ? <MarkAllReadButton label={t('markAllRead')} /> : undefined}
    >
      {notifications.length === 0 ? (
        <EmptyState title={t('empty')} />
      ) : (
        <RowList>
          {notifications.map((n) => {
            const endsAt = n.type === 'subscription.expiring' ? expiryDate(n.payload) : null
            return (
            <Row key={n.id} className="items-start">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium">{notificationLabel(n.type)}</span>
                  {n.readAt === null && <Badge tone="brand">{t('unread')}</Badge>}
                </div>
                {endsAt && <p className="mt-2 text-sm text-muted-foreground"><time dateTime={endsAt}>{t('subscriptionExpiringDetail', { date: formatKLDateTime(endsAt, detectedLocale) })}</time></p>}
                {n.type === 'subscription.expiring' && role === 'OWNER' && <a href={'/' + detectedLocale + '/e/billing'} className="mt-1 inline-flex min-h-10 items-center text-sm text-brand underline underline-offset-4">{t('subscriptionBilling')}</a>}
              </div>
              <span className="shrink-0 pt-0.5 text-xs text-muted-foreground">
                {formatKLDate(n.createdAt, detectedLocale)}
              </span>
            </Row>
            )
          })}
        </RowList>
      )}

      <NotificationsClient ids={ids} />
    </WorkspacePage>
  )
}
