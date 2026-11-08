import { notFound } from 'next/navigation'
import Link from 'next/link'
import { headers } from 'next/headers'
import { getTranslations } from 'next-intl/server'
import { requireAdmin } from '@/server/authz'
import { getPartner, isPartnerLogoKey } from '@/server/services/admin-schools-partners'
import { getSignedDisplayUrl } from '@/lib/storage'
import { PartnerForm } from './partner-form'

export default async function AdminPartnerDetailPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>
}) {
  const { locale, id } = await params
  const ctx = await requireAdmin(await headers())
  const t = await getTranslations('adminPartners')

  const isNew = id === 'new'
  const partner = isNew ? null : await getPartner(ctx, id).catch(() => null)

  if (!isNew && !partner) return notFound()

  let logoUrl: string | null = null
  if (partner?.logoKey && isPartnerLogoKey(partner.logoKey)) {
    try {
      logoUrl = await getSignedDisplayUrl(partner.logoKey)
    } catch {
      // logo unavailable, ignore
    }
  }

  return (
    <main id="main-content" className="p-6 max-w-2xl mx-auto">
      <div className="mb-6">
        <Link
          href={`/${locale}/admin/partners`}
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          ← {t('backToList')}
        </Link>
      </div>
      <h1 className="text-2xl font-bold mb-6">
        {isNew ? t('newTitle') : t('editTitle')}
      </h1>
      <PartnerForm locale={locale} partner={partner} initialLogoUrl={logoUrl} />
    </main>
  )
}
