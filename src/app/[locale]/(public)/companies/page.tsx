import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { getMemberIdentity } from '@/server/services/member-identity'
import { PublicCompanyShowcase } from '@/components/marketing/public-company-showcase'

interface Props {
  params: Promise<{ locale: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('publicCompanies')
  return { title: t('title'), description: t('description') }
}

export default async function CompaniesShowcasePage({ params, searchParams }: Props) {
  const { locale } = await params
  const member = await getMemberIdentity()
  if (member?.role === 'STUDENT') {
    const query = new URLSearchParams()
    for (const [key, value] of Object.entries(await searchParams)) {
      if (typeof value === 'string') query.set(key, value)
    }
    redirect(`/${locale}/s/companies${query.size ? `?${query}` : ''}`)
  }
  return <PublicCompanyShowcase locale={locale} />
}
