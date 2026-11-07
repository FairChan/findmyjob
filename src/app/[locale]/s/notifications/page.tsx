import { headers } from 'next/headers'
import Link from 'next/link'
import { getTranslations } from 'next-intl/server'
import { requireStudent } from '@/server/authz'
import { listNotifications, markAllNotificationsRead } from '@/server/services/notifications'

export default async function NotificationsPage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  const t = await getTranslations('notifications')
  const { userId } = await requireStudent(await headers())

  const notifications = await listNotifications({ userId })
  await markAllNotificationsRead({ userId })

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
      case 'system.alert':
        return t('systemAlert')
      default:
        return t('unknownType')
    }
  }

  return (
    <main id="main-content" className="container mx-auto max-w-2xl px-4 py-8">
      <h1 className="mb-2 text-2xl font-bold">{t('title')}</h1>
      <p className="mb-6 text-sm text-muted-foreground">{t('subtitle')}</p>

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
                {new Date(n.createdAt).toLocaleDateString()}
              </span>
            </li>
          ))}
        </ul>
      )}
    </main>
  )
}
