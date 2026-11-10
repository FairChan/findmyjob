import { getTranslations } from 'next-intl/server'
import { Link } from '@/i18n/navigation'
import { Wordmark } from './wordmark'

const FOOTER_LINK =
  'inline-flex min-h-6 items-center text-xs text-muted-foreground transition-colors hover:text-foreground'

export default async function Footer() {
  const t = await getTranslations('footer')
  const nav = await getTranslations('nav')
  const year = new Date().getFullYear()

  return (
    <footer className="border-t bg-muted">
      <div className="page-shell py-10">
        <div className="flex flex-col gap-6 sm:flex-row sm:items-start sm:justify-between">
          <div className="max-w-xs">
            <p className="text-base">
              <Wordmark />
            </p>
            <p className="mt-1.5 text-xs text-muted-foreground">{t('tagline')}</p>
          </div>
          <nav className="flex flex-wrap gap-x-6 gap-y-2" aria-label="footer">
            <Link href="/for-employers" className={FOOTER_LINK}>
              {t('forEmployers')}
            </Link>
            <Link href="/partners" className={FOOTER_LINK}>
              {t('partners')}
            </Link>
            <Link href="/safety" className={FOOTER_LINK}>
              {t('safety')}
            </Link>
            <Link href="/pricing" className={FOOTER_LINK}>
              {nav('pricing')}
            </Link>
            <Link href="/legal/privacy" className={FOOTER_LINK}>
              {t('privacy')}
            </Link>
            <Link href="/legal/terms" className={FOOTER_LINK}>
              {t('terms')}
            </Link>
          </nav>
        </div>
        <p className="mt-8 border-t pt-5 text-xs text-muted-foreground">{t('copyright', { year })}</p>
      </div>
    </footer>
  )
}
