import type { Metadata } from 'next'
import { getTranslations } from 'next-intl/server'
import { readLegalMarkdown } from '@/lib/legal-content'
import LegalProse from '@/components/legal/legal-prose'
import { getSetting } from '@/server/services/settings'

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>
}): Promise<Metadata> {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'legal' })
  return {
    title: t('privacyTitle'),
    robots: { index: false },
  }
}

export default async function PrivacyPage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'legal' })
  const version = await getSetting('legal.currentVersion', '2026-11-draft')
  const content = readLegalMarkdown('privacy', locale)

  return (
    <article className="container mx-auto max-w-3xl px-4 py-12">
      <div className="mb-6 text-xs text-muted-foreground">
        {t('lastUpdated', { version })}
      </div>
      <LegalProse content={content} />
      <div className="mt-12 text-center">
        <a
          href={`/${locale}`}
          className="text-sm text-brand underline underline-offset-4 hover:text-brand/80"
        >
          {t('backToHome')}
        </a>
      </div>
    </article>
  )
}
