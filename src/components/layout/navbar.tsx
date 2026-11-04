import { getTranslations } from 'next-intl/server'
import { Link } from '@/i18n/navigation'
import type { Locale } from '@/i18n/routing'
import LocaleSwitcher from './locale-switcher'
import MobileMenu from './mobile-menu'

export default async function Navbar({ locale }: { locale: Locale }) {
  const t = await getTranslations('nav')

  return (
    <header className="sticky top-0 z-40 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="container mx-auto flex h-14 max-w-5xl items-center justify-between px-4">
        <Link href="/" className="font-bold text-xl text-brand">
          FindMYJob
        </Link>

        {/* Desktop nav */}
        <nav className="hidden md:flex items-center gap-6" aria-label={t('home')}>
          <Link href="/" className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors">
            {t('home')}
          </Link>
          <Link href="/jobs" className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors">
            {t('jobs')}
          </Link>
          <Link href="/companies" className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors">
            {t('companies')}
          </Link>
        </nav>

        <div className="hidden md:flex items-center gap-4">
          <LocaleSwitcher currentLocale={locale} />
          <Link href="/login" className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors">
            {t('login')}
          </Link>
          <Link href="/register" className="rounded-md bg-brand px-3 py-1.5 text-sm font-medium text-brand-foreground hover:bg-brand/90 transition-colors">
            {t('register')}
          </Link>
        </div>

        {/* Mobile */}
        <MobileMenu locale={locale} />
      </div>
    </header>
  )
}
