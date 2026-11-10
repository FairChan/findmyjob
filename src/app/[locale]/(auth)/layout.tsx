import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import type { Locale } from '@/i18n/routing'
import { AuthShell } from '@/components/layout/auth-shell'

// Sign-in and consent steps set no title of their own.
export const metadata: Metadata = { title: 'FindMYJob' }

export default async function AuthLayout({
  children,
  params,
}: {
  children: ReactNode
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  return <AuthShell locale={locale as Locale}>{children}</AuthShell>
}
