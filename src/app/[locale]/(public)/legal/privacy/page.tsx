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
    <article className="page-shell max-w-3xl py-12 md:py-16">
      <div className="mb-6 text-xs text-muted-foreground">
        {t('lastUpdated', { version })}
      </div>
      <LegalProse content={content} />
      <div className="mt-12 text-center">
        <a
          href={`/${locale}`}
          className="inline-flex min-h-6 items-center text-sm text-brand underline-offset-4 hover:underline"
        >
          {t('backToHome')}
        </a>
      </div>
    </article>
  )
}
