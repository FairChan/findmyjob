import type { ReactNode } from 'react'
import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { headers } from 'next/headers'
import { getTranslations } from 'next-intl/server'
import { requireEmployer } from '@/server/authz'
import { ForbiddenError } from '@/server/errors'
import { db } from '@/server/db'

export const metadata: Metadata = {
  title: { default: 'FindMYJob', template: '%s · FindMYJob' },
}

export default async function EmployerLayout({
  children,
  params,
}: {
  children: ReactNode
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  let userId: string
  try {
    const ctx = await requireEmployer(await headers())
    userId = ctx.userId
  } catch (err) {
    if (err instanceof ForbiddenError) {
      redirect(`/${locale}/login`)
    }
    throw err
  }

  const t = await getTranslations('employerLayout')
  const marketing = await getTranslations('marketing')
  const unreadCount = await db.notification.count({ where: { userId, readAt: null } })
  const bellLabel = unreadCount > 0
    ? t('bellLabelWithCount', { count: unreadCount > 99 ? '99+' : unreadCount })
    : t('bellLabel')

  return (
    <>
      <header className="border-b bg-white">
        <div className="container mx-auto flex min-h-12 max-w-5xl flex-wrap items-center justify-end gap-3 px-4">
          <Link href={`/${locale}/e/preferences`} prefetch={false}
            className="inline-flex min-h-11 items-center rounded-md px-2 py-1 text-sm text-muted-foreground underline underline-offset-4 hover:bg-muted hover:text-foreground">
            {marketing('preferencesLink')}
          </Link>
          <Link
            href={`/${locale}/e/notifications`}
            aria-label={bellLabel}
            className="relative flex items-center gap-1 rounded-md px-2 py-1 text-sm text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
          >
            <span aria-hidden="true">🔔</span>
            {unreadCount > 0 && (
              <span
                aria-hidden="true"
                className="inline-flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-primary px-1 text-[10px] font-medium text-primary-foreground"
              >
                {unreadCount > 99 ? '99+' : unreadCount}
              </span>
            )}
          </Link>
        </div>
      </header>
      {children}
    </>
  )
}
