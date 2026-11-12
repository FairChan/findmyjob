import type { ReactNode } from 'react'
import type { Locale } from '@/i18n/routing'
import { PublicShell } from '@/components/layout/public-shell'

export default async function PricingLayout({
  children,
  params,
}: {
  children: ReactNode
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  return <PublicShell locale={locale as Locale}>{children}</PublicShell>
}
