import type { Metadata } from 'next'
import { getTranslations } from 'next-intl/server'
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

  return (
    <section className="container mx-auto max-w-lg px-4 py-24">
      <div className="rounded-lg border border-border bg-card p-8 shadow-sm">
        <h1 className="text-xl font-bold text-foreground mb-3">
          {t('reconsentTitle')}
        </h1>
        <p className="text-sm text-muted-foreground mb-6">
          {t('reconsentDescription')}
        </p>
        <ReconsentForm
          locale={locale}
          messages={{
            reconsentAgree: t('reconsentAgree'),
            reconsentSubmit: t('reconsentSubmit'),
            reconsentRequired: t('reconsentRequired'),
            reconsentViewPrivacy: t('reconsentViewPrivacy'),
            reconsentViewTerms: t('reconsentViewTerms'),
            reconsentSuccess: t('reconsentSuccess'),
          }}
        />
      </div>
    </section>
  )
}
