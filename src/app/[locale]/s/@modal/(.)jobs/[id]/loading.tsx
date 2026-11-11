import { getTranslations } from 'next-intl/server'

export default async function LoadingJobModal() {
  const t = await getTranslations('jobBrowser')
  return <div role="status" className="py-12 text-center text-sm text-muted-foreground">{t('loading')}</div>
}
