import { getTranslations } from 'next-intl/server'

export default async function JobModalNotFound() {
  const t = await getTranslations('jobBrowser')
  return <p role="status" className="py-12 text-center text-sm text-muted-foreground">{t('unavailable')}</p>
}
