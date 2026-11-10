import { getTranslations } from 'next-intl/server'
import { Link } from '@/i18n/navigation'
import type { Locale } from '@/i18n/routing'
import { Button } from '@/components/ui/button'
import LocaleSwitcher from './locale-switcher'
import MobileMenu from './mobile-menu'
import { Wordmark } from './wordmark'

const NAV_LINK =
  'inline-flex min-h-8 items-center rounded-full px-3 text-[13px] text-foreground/80 transition-colors hover:text-foreground'

export default async function Navbar({ locale }: { locale: Locale }) {
  const t = await getTranslations('nav')

  return (
    <header className="sticky top-0 z-40 border-b border-border/70 bg-background/80 backdrop-blur-xl backdrop-saturate-150">
      <div className="page-shell flex h-12 items-center justify-between">
        <Link href="/" className="-ml-1 rounded-md px-1 text-[19px]">
          <Wordmark />
        </Link>

        {/* Desktop nav */}
        <nav className="hidden lg:flex items-center gap-1" aria-label={t('primaryNavigation')}>
          <Link href="/jobs" className={NAV_LINK}>
            {t('jobs')}
          </Link>
          <Link href="/companies" className={NAV_LINK}>
            {t('companies')}
          </Link>
          <Link href="/for-employers" className={NAV_LINK}>
            {t('forEmployers')}
          </Link>
          <Link href="/safety" className={NAV_LINK}>
            {t('safety')}
          </Link>
        </nav>

        <div className="hidden lg:flex items-center gap-3">
          <LocaleSwitcher currentLocale={locale} />
          <Link href="/login" className={NAV_LINK}>
            {t('login')}
          </Link>
          <Button asChild variant="brand" size="sm" className="h-8 px-3.5 text-[13px]">
            <Link href="/register">{t('register')}</Link>
          </Button>
        </div>

        {/* Mobile */}
        <MobileMenu locale={locale} />
      </div>
    </header>
  )
}
