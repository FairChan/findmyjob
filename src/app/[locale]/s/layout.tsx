import type { ReactNode } from 'react'
import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { headers } from 'next/headers'
import { requireStudent } from '@/server/authz'
import { ForbiddenError } from '@/server/errors'
import type { Locale } from '@/i18n/routing'
import { MemberNavigation } from '@/components/layout/member-navigation'

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
  try {
    await requireStudent(await headers())
  } catch (err) {
    if (err instanceof ForbiddenError) {
      redirect(`/${locale}/login`)
    }
    throw err
  }
  return (
    <div className="flex flex-1 flex-col">
      <MemberNavigation locale={locale as Locale} />
      <main id="main-content" className="min-w-0 flex-1">{children}</main>
    </div>
  )
}
