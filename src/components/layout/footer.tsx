import { getTranslations } from 'next-intl/server'
import { Link } from '@/i18n/navigation'

export default async function Footer() {
  const t = await getTranslations('footer')
  const year = new Date().getFullYear()

  return (
    <footer className="border-t bg-muted/40">
      <div className="container mx-auto max-w-5xl px-4 py-8">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-sm font-semibold text-brand">FindMYJob</p>
            <p className="mt-1 text-xs text-muted-foreground">{t('tagline')}</p>
          </div>
          <nav className="flex flex-wrap gap-x-6 gap-y-2" aria-label="footer">
            <Link href="/for-employers" className="text-xs text-muted-foreground hover:text-foreground transition-colors">
              {t('forEmployers')}
            </Link>
            <Link href="/partners" className="text-xs text-muted-foreground hover:text-foreground transition-colors">
              {t('partners')}
            </Link>
            <Link href="/legal/privacy" className="text-xs text-muted-foreground hover:text-foreground transition-colors">
              {t('privacy')}
            </Link>
            <Link href="/legal/terms" className="text-xs text-muted-foreground hover:text-foreground transition-colors">
              {t('terms')}
            </Link>
          </nav>
          <p className="text-xs text-muted-foreground">{t('copyright', { year })}</p>
        </div>
      </div>
    </footer>
  )
}
