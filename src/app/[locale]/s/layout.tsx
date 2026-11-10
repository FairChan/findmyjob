import type { ReactNode } from 'react'
import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { headers } from 'next/headers'
import { getTranslations } from 'next-intl/server'
import { requireStudent } from '@/server/authz'
import { ForbiddenError } from '@/server/errors'
import type { Locale } from '@/i18n/routing'
import { AppShell } from '@/components/layout/app-shell'
import StudentNav from '@/components/layout/StudentNav'

export const metadata: Metadata = {
  title: { default: 'FindMYJob', template: '%s · FindMYJob' },
}

export default async function StudentLayout({
  children,
  params,
}: {
  children: ReactNode
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  let userId: string
  try {
    const ctx = await requireStudent(await headers())
    userId = ctx.userId
  } catch (err) {
    if (err instanceof ForbiddenError) {
      redirect(`/${locale}/login`)
    }
    throw err
  }
  const t = await getTranslations('appNav')
  return (
    <AppShell
      locale={locale as Locale}
      area={t('studentArea')}
      nav={<StudentNav userId={userId} locale={locale} />}
    >
      {children}
    </AppShell>
  )
}
