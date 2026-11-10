import type { ReactNode } from 'react'
import type { Locale } from '@/i18n/routing'
import { AuthShell } from '@/components/layout/auth-shell'

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
