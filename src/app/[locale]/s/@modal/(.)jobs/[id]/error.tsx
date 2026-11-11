'use client'

import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'

export default function JobModalError({ retry }: { retry: () => void }) {
  const t = useTranslations('jobBrowser')
  return (
    <div className="space-y-5 py-12 text-center">
      <p role="alert" className="text-sm text-muted-foreground">{t('error')}</p>
      <Button variant="secondary" onClick={retry}>{t('retry')}</Button>
    </div>
  )
}
