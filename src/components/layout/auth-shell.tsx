import type { ReactNode } from 'react'
import { getTranslations } from 'next-intl/server'
import { Link } from '@/i18n/navigation'
import type { Locale } from '@/i18n/routing'
import LocaleSwitcher from './locale-switcher'
import { Wordmark } from './wordmark'

const FOOTER_LINK =
  'inline-flex min-h-6 items-center text-xs text-muted-foreground transition-colors hover:text-foreground'

/**
 * Chrome for sign-in, sign-up and consent steps: nothing to wander off to, just the
 * way home, the language switch and the two legal documents the forms refer to.
 */
export async function AuthShell({ locale, children }: { locale: Locale; children: ReactNode }) {
  const t = await getTranslations('footer')
  const year = new Date().getFullYear()

  return (
    <div className="flex flex-1 flex-col bg-muted">
      <header className="border-b border-border/70 bg-background/80 backdrop-blur-xl backdrop-saturate-150">
        <div className="page-shell flex h-12 items-center justify-between">
          <Link href="/" className="-ml-1 rounded-md px-1 text-[19px]">
            <Wordmark />
          </Link>
          <LocaleSwitcher currentLocale={locale} />
        </div>
      </header>
      <main id="main-content" className="flex-1">
        {children}
      </main>
      <footer className="page-shell flex flex-wrap items-center justify-between gap-x-6 gap-y-2 py-6">
        <p className="text-xs text-muted-foreground">{t('copyright', { year })}</p>
        <nav className="flex gap-x-6" aria-label="footer">
          <Link href="/legal/privacy" className={FOOTER_LINK}>
            {t('privacy')}
          </Link>
          <Link href="/legal/terms" className={FOOTER_LINK}>
            {t('terms')}
          </Link>
        </nav>
      </footer>
    </div>
  )
}
