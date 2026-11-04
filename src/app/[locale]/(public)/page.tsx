import { getTranslations } from 'next-intl/server'
import { Link } from '@/i18n/navigation'

export default async function HomePage() {
  const t = await getTranslations('home')

  return (
    <section className="container mx-auto max-w-5xl px-4 py-24 text-center">
      <h1 className="text-4xl font-bold tracking-tight text-brand sm:text-5xl">
        {t('title')}
      </h1>
      <p className="mt-4 text-lg text-muted-foreground">{t('subtitle')}</p>
      <div className="mt-8 flex flex-wrap justify-center gap-4">
        <Link
          href="/jobs"
          className="rounded-md bg-brand px-6 py-2.5 text-sm font-semibold text-brand-foreground hover:bg-brand/90 transition-colors"
        >
          {t('ctaJobs')}
        </Link>
        <Link
          href="/register/student"
          className="rounded-md border border-brand px-6 py-2.5 text-sm font-semibold text-brand hover:bg-brand/5 transition-colors"
        >
          {t('ctaRegister')}
        </Link>
      </div>
    </section>
  )
}
