import type { Metadata } from 'next'
import Image from 'next/image'
import { getTranslations } from 'next-intl/server'
import { getPublicPartners } from '@/server/services/admin-schools-partners'
import { safeWebsiteHref } from '@/lib/url-utils'

interface Props {
  params: Promise<{ locale: string }>
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'partners' })
  const baseUrl = (process.env.APP_URL ?? '').replace(/\/$/, '')
  return {
    title: t('title'),
    description: t('description'),
    alternates: {
      canonical: `${baseUrl}/${locale}/partners`,
      languages: {
        'zh-Hans': `${baseUrl}/zh/partners`,
        'en': `${baseUrl}/en/partners`,
        'x-default': `${baseUrl}/zh/partners`,
      },
    },
  }
}

export default async function PartnersPage({ params }: Props) {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'partners' })
  const partners = await getPublicPartners()

  const typeKey = (type: string) => {
    const map: Record<string, string> = {
      SCHOOL: 'typeSCHOOL',
      ALUMNI_ASSOCIATION: 'typeALUMNI_ASSOCIATION',
      SOE: 'typeSOE',
      ENTERPRISE: 'typeENTERPRISE',
      GOVERNMENT: 'typeGOVERNMENT',
      NGO: 'typeNGO',
    }
    return map[type] ?? 'typeENTERPRISE'
  }

  return (
    <>
      {/* Hero */}
      <section className="bg-gradient-to-br from-brand to-brand/70 py-16 md:py-24 text-white">
        <div className="container mx-auto max-w-5xl px-4">
          <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">{t('heroTitle')}</h1>
          <p className="mt-4 text-lg text-white/85 max-w-2xl">{t('heroSubtitle')}</p>
        </div>
      </section>

      {/* Partners list */}
      <section className="py-16">
        <div className="container mx-auto max-w-5xl px-4">
          <h2 className="text-2xl font-semibold mb-8">{t('allPartnersTitle')}</h2>
          {partners.length === 0 ? (
            <p className="text-muted-foreground">{t('noPartners')}</p>
          ) : (
            <ul className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {partners.map((p) => {
                const name = locale === 'zh' ? p.name : (p.nameEn ?? p.name)
                const href = safeWebsiteHref(p.website)
                return (
                  <li key={p.id} className="rounded-xl border bg-background p-5 flex flex-col gap-3">
                    <div className="flex items-center gap-3">
                      {p.hasLogo && (
                        <Image
                          src={`/api/partner-logos/${p.id}`}
                          alt=""
                          aria-hidden="true"
                          width={40}
                          height={40}
                          className="size-10 rounded object-contain flex-shrink-0"
                          unoptimized
                        />
                      )}
                      <div className="min-w-0">
                        <p className="font-semibold leading-tight truncate">{name}</p>
                        <p className="text-xs text-muted-foreground mt-0.5">{t(typeKey(p.type))}</p>
                      </div>
                    </div>
                    {p.description && (
                      <p className="text-sm text-muted-foreground line-clamp-3">{p.description}</p>
                    )}
                    {href && (
                      <a
                        href={href}
                        target="_blank"
                        rel="noopener noreferrer nofollow"
                        className="text-xs text-brand hover:underline underline-offset-4 mt-auto"
                      >
                        {new URL(href).hostname}
                      </a>
                    )}
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      </section>

      {/* Contact section */}
      <section className="py-12 border-t bg-muted/20">
        <div className="container mx-auto max-w-5xl px-4">
          <div className="rounded-xl border bg-background p-6 md:p-8">
            <h2 className="text-xl font-semibold">{t('contactTitle')}</h2>
            <p className="mt-2 text-sm text-muted-foreground">{t('contactDesc')}</p>
          </div>
        </div>
      </section>
    </>
  )
}
