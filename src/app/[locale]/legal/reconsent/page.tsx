import type { Metadata } from 'next'
import { getTranslations } from 'next-intl/server'
import { getSetting } from '@/server/services/settings'
import ReconsentForm from './reconsent-form'

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>
}): Promise<Metadata> {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'legal' })
  return {
    title: t('reconsentTitle'),
    robots: { index: false, follow: false },
  }
}

export default async function ReconsentPage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'legal' })
  const currentVersion = await getSetting('legal.currentVersion', '2026-11-draft')

  return (
    <section className="container mx-auto max-w-lg px-4 py-24">
      <div className="rounded-lg border border-border bg-card p-8 shadow-sm">
        <h1 className="text-xl font-bold text-foreground mb-3">
          {t('reconsentTitle')}
        </h1>
        <p className="text-sm text-muted-foreground mb-2">
          {t('reconsentDescription')}
        </p>
        <p className="text-xs text-muted-foreground mb-6">
          {t('lastUpdated', { version: currentVersion })}
        </p>
        <ReconsentForm
          locale={locale}
          version={currentVersion}
          messages={{
            reconsentAgree: t('reconsentAgree'),
            reconsentSubmit: t('reconsentSubmit'),
            reconsentRequired: t('reconsentRequired'),
            reconsentViewPrivacy: t('reconsentViewPrivacy'),
            reconsentViewTerms: t('reconsentViewTerms'),
            reconsentSuccess: t('reconsentSuccess'),
            reconsentVersionMismatch: t('reconsentVersionMismatch'),
          }}
        />
      </div>
    </section>
  )
}
