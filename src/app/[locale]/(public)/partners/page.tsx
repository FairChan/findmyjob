import type { Metadata } from 'next'
import Image from 'next/image'
import { getTranslations } from 'next-intl/server'
import { EmptyState } from '@/components/ui/empty-state'
import { PageHeader } from '@/components/ui/page-header'
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
    <div className="page-shell pb-20 pt-10 md:pt-14">
      <PageHeader title={t('heroTitle')} lead={t('heroSubtitle')} />

      {/* Partners list */}
      <section className="mt-14">
        <h2 className="text-title">{t('allPartnersTitle')}</h2>
        {partners.length === 0 ? (
          <EmptyState className="mt-6" title={<span className="text-body font-medium">{t('noPartners')}</span>} />
        ) : (
          <ul className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {partners.map((p) => {
              const name = locale === 'zh' ? p.name : (p.nameEn ?? p.name)
              const href = safeWebsiteHref(p.website)
              return (
                <li key={p.id} className="flex flex-col gap-3 rounded-card bg-muted p-6">
                  <div className="flex items-center gap-3">
                    {p.hasLogo && (
                      <Image
                        src={`/api/partner-logos/${p.id}`}
                        alt=""
                        aria-hidden="true"
                        width={40}
                        height={40}
                        className="size-10 shrink-0 rounded-control bg-card object-contain"
                        unoptimized
                      />
                    )}
                    <div className="min-w-0">
                      <p className="truncate text-body font-semibold leading-tight">{name}</p>
                      <p className="mt-0.5 text-xs text-muted-foreground">{t(typeKey(p.type))}</p>
                    </div>
                  </div>
                  {p.description && (
                    <p className="line-clamp-3 text-sm text-muted-foreground">{p.description}</p>
                  )}
                  {href && (
                    <a
                      href={href}
                      target="_blank"
                      rel="noopener noreferrer nofollow"
                      className="mt-auto inline-flex min-h-6 items-center self-start text-sm text-brand underline-offset-4 hover:underline"
                    >
                      {new URL(href).hostname}
                    </a>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </section>

      {/* Contact section */}
      <section className="mt-14 rounded-tile bg-foreground p-7 text-background sm:p-10">
        <h2 className="text-title">{t('contactTitle')}</h2>
        <p className="mt-3 max-w-2xl text-body text-background/80">{t('contactDesc')}</p>
      </section>
    </div>
  )
}
