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
    <section className="page-shell max-w-lg py-10 md:py-16">
      <div className="auth-enter rounded-tile bg-card p-6 shadow-float sm:p-8">
        <h1 className="mb-3 text-title">
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
