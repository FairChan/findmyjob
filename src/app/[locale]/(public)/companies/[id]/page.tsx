import { notFound } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { z } from 'zod'
import { getPublicCompany, isOwnLogoKey } from '@/server/services/company'
import { getSignedDisplayUrl } from '@/lib/storage'
import { safeWebsiteHref } from '@/lib/url-utils'

const companyIdSchema = z.string().cuid()

export default async function CompanyPublicPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>
}) {
  const { locale, id } = await params
  const t = await getTranslations('companyProfile')

  if (!companyIdSchema.safeParse(id).success) return notFound()

  const company = await getPublicCompany(id)
  if (!company) return notFound()
  // Write-time validation already requires http(s); this also covers older or imported rows.
  const websiteHref = safeWebsiteHref(company.website)

  const displayName =
    locale === 'zh'
      ? (company.displayNameZh ?? company.legalName)
      : (company.displayNameEn ?? company.legalName)

  let logoUrl: string | null = null
  if (company.logoKey && isOwnLogoKey(company.id, company.logoKey)) {
    try {
      logoUrl = await getSignedDisplayUrl(company.logoKey)
    } catch {
      // logo unavailable, fall through to initials placeholder
    }
  }

  const locationParts = [company.city, company.state].filter(Boolean)

  return (
    <div className="container mx-auto max-w-3xl px-4 py-12">
      {/* Company header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center gap-6 mb-8">
        {logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={logoUrl}
            alt={displayName}
            className="w-20 h-20 rounded-lg object-contain border bg-white flex-shrink-0"
          />
        ) : (
          <div className="w-20 h-20 rounded-lg border bg-muted flex items-center justify-center text-2xl font-bold text-muted-foreground flex-shrink-0">
            {displayName.charAt(0)}
          </div>
        )}

        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-bold break-words">{displayName}</h1>
            {company.isFoundingPartner && (
              <span className="inline-flex items-center rounded-full bg-amber-100 px-3 py-0.5 text-xs font-semibold text-amber-800 border border-amber-200 whitespace-nowrap">
                {t('foundingPartner')}
              </span>
            )}
          </div>

          {displayName !== company.legalName && (
            <p className="text-sm text-muted-foreground mt-0.5">{company.legalName}</p>
          )}

          {locationParts.length > 0 && (
            <p className="text-sm text-muted-foreground mt-1">
              {t('location')}: {locationParts.join(', ')}
            </p>
          )}

          {websiteHref && (
            <a
              href={websiteHref}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-primary underline underline-offset-2 hover:text-primary/80 mt-1 inline-block"
            >
              {t('website')}
            </a>
          )}
        </div>
      </div>

      {/* Description */}
      {company.description && (
        <section className="mb-8">
          <p className="text-sm leading-relaxed whitespace-pre-wrap text-foreground">
            {company.description}
          </p>
        </section>
      )}

      {/* Open positions */}
      <section>
        <h2 className="text-lg font-semibold mb-4">{t('openPositions')}</h2>
        <p className="text-sm text-muted-foreground">{t('noJobs')}</p>
      </section>
    </div>
  )
}
