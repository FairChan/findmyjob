import { SearchX } from 'lucide-react'
import { getLocale, getTranslations } from 'next-intl/server'
import { Link } from '@/i18n/navigation'
import type { Locale } from '@/i18n/routing'
import { PublicShell } from '@/components/layout/public-shell'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { TextLink } from '@/components/ui/text-link'

export default async function NotFound() {
  const locale = (await getLocale()) as Locale
  const t = await getTranslations('notFound')

  return (
    <PublicShell locale={locale}>
      <div className="page-shell max-w-2xl py-20 md:py-28">
        <EmptyState
          icon={<SearchX strokeWidth={1.75} />}
          title={<h1 className="text-title">{t('title')}</h1>}
          description={t('description')}
          action={
            <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-3">
              <Button asChild variant="brand">
                <Link href="/">{t('home')}</Link>
              </Button>
              <TextLink href="/jobs" prefetch={false}>
                {t('jobs')}
              </TextLink>
            </div>
          }
        />
      </div>
    </PublicShell>
  )
}
