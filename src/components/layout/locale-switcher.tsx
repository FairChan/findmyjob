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
    <div className="flex items-center rounded-full bg-muted p-0.5" aria-label={t('label')}>
      {routing.locales.map((locale) => (
        <button
          key={locale}
          onClick={() => handleChange(locale)}
          className={
            locale === currentLocale
              ? 'min-h-7 rounded-full bg-background px-2.5 text-xs font-medium text-foreground shadow-sm'
              : 'min-h-7 rounded-full px-2.5 text-xs text-muted-foreground transition-colors hover:text-foreground'
          }
          aria-current={locale === currentLocale ? 'true' : undefined}
        >
          {t(locale)}
        </button>
      ))}
    </div>
  )
}
