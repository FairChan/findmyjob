import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { getMemberIdentity } from '@/server/services/member-identity'
import { PublicJobShowcase } from '@/components/marketing/public-job-showcase'

interface Props {
  params: Promise<{ locale: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('publicJobs')
  return { title: t('title'), description: t('description') }
}

export default async function JobsShowcasePage({ params, searchParams }: Props) {
  const { locale } = await params
  const member = await getMemberIdentity()
  if (member?.role === 'STUDENT') {
    const query = new URLSearchParams()
    for (const [key, value] of Object.entries(await searchParams)) {
      if (typeof value === 'string') query.set(key, value)
    }
    redirect(`/${locale}/s/jobs${query.size ? `?${query}` : ''}`)
  }
  return <PublicJobShowcase locale={locale} />
}
