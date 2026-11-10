import type { ReactNode } from 'react'
import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { headers } from 'next/headers'
import { getTranslations } from 'next-intl/server'
import { requireEmployer } from '@/server/authz'
import { ForbiddenError } from '@/server/errors'
import type { Locale } from '@/i18n/routing'
import { AppShell } from '@/components/layout/app-shell'
import EmployerNav from '@/components/layout/EmployerNav'

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

  const tApp = await getTranslations('appNav')
  const marketing = await getTranslations('marketing')

  return (
    <AppShell
      locale={locale as Locale}
      area={tApp('employerArea')}
      nav={<EmployerNav userId={userId} />}
      actions={
        // Email preferences must stay reachable for every employer, whatever their company
        // membership, so this link is built here and never depends on the role-aware nav.
        <Link
          href={`/${locale}/e/preferences`}
          prefetch={false}
          className="inline-flex min-h-8 items-center whitespace-nowrap rounded-full px-2 text-[13px] text-foreground/80 transition-colors hover:text-foreground sm:px-3"
        >
          {marketing('preferencesLink')}
        </Link>
      }
    >
      {children}
    </AppShell>
  )
}
