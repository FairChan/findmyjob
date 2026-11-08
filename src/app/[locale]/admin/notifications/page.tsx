import { headers } from 'next/headers'
import { getTranslations, getLocale } from 'next-intl/server'
import { requireAdmin } from '@/server/authz'
import { listNotifications } from '@/server/services/notifications'
import { NotificationsClient } from '@/components/notifications/NotificationsClient'
import { MarkAllReadButton } from '@/components/notifications/MarkAllReadButton'
import { formatKLDate } from '@/lib/format-date'

export default async function AdminNotificationsPage() {
  const t = await getTranslations('notifications')
  const detectedLocale = await getLocale()
  const { userId } = await requireAdmin(await headers())

  const notifications = await listNotifications({ userId })
  const ids = notifications.map((n) => n.id)
  const unreadCount = notifications.filter((n) => n.readAt === null).length

  function notificationLabel(type: string): string {
    switch (type) {
      case 'system.alert':
        return t('systemAlert')
      case 'report.new':
        return t('reportNew')
      default:
        return t('unknownType')
    }
  }

  return (
    <main id="main-content" className="container mx-auto px-4 py-8">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="mb-1 text-2xl font-bold">{t('title')}</h1>
          <p className="text-sm text-muted-foreground">{t('subtitleAdmin')}</p>
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
                {typeof (n.payload as Record<string, unknown>).message === 'string' && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    {String((n.payload as Record<string, unknown>).message)}
                  </p>
                )}
              </div>
              <span className="shrink-0 text-xs text-muted-foreground">
                {formatKLDate(n.createdAt, detectedLocale)}
              </span>
            </li>
          ))}
        </ul>
      )}

      <NotificationsClient ids={ids} />
    </main>
  )
}
