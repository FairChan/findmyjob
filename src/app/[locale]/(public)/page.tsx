import { getTranslations } from 'next-intl/server'
import { Link } from '@/i18n/navigation'
import { getHomePartners } from '@/server/services/admin-schools-partners'

export default async function HomePage() {
  const t = await getTranslations('home')
  const partners = await getHomePartners()

  return (
    <>
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

      {partners.length > 0 && (
        <section className="border-t bg-muted/30 py-12">
          <div className="container mx-auto max-w-5xl px-4 text-center">
            <h2 className="mb-8 text-sm font-semibold uppercase tracking-widest text-muted-foreground">
              {t('partnersTitle')}
            </h2>
            <ul className="flex flex-wrap items-center justify-center gap-6">
              {partners.map((p) => (
                <li key={p.id}>
                  {p.website ? (
                    <a
                      href={p.website}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sm font-medium text-foreground/70 hover:text-foreground transition-colors"
                    >
                      {p.nameEn ?? p.name}
                    </a>
                  ) : (
                    <span className="text-sm font-medium text-foreground/70">
                      {p.nameEn ?? p.name}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        </section>
      )}
    </>
  )
}
