'use client'

import { useTranslations } from 'next-intl'
import { usePathname, useRouter } from '@/i18n/navigation'
import { routing, type Locale } from '@/i18n/routing'

export default function LocaleSwitcher({ currentLocale }: { currentLocale: Locale }) {
  const t = useTranslations('localeSwitcher')
  const pathname = usePathname()
  const router = useRouter()

  function handleChange(next: Locale) {
    router.replace(pathname, { locale: next })
  }

  return (
    <div className="flex items-center gap-1" aria-label={t('label')}>
      {routing.locales.map((locale) => (
        <button
          key={locale}
          onClick={() => handleChange(locale)}
          className={
            locale === currentLocale
              ? 'text-sm font-medium text-brand'
              : 'text-sm text-muted-foreground hover:text-foreground'
          }
          aria-current={locale === currentLocale ? 'true' : undefined}
        >
          {t(locale)}
        </button>
      ))}
    </div>
  )
}
