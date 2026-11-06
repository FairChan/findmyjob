import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { requireCompanyMember } from '@/server/authz'
import { getMyCompany } from '@/server/services/company'
import { INDUSTRIES } from '@/server/lib/taxonomy/industries'
import { updateCompanyAction } from '@/server/actions/company'
import CompanyForm from '@/components/company/company-form'
import type { CompanyFormData } from '@/components/company/company-form'

export default async function CompanyEditPage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  const t = await getTranslations('companyEdit')

  const ctx = await requireCompanyMember('ADMIN', await headers())
  const company = await getMyCompany({ userId: ctx.userId })

  if (!company) {
    redirect(`/${locale}/e/onboarding`)
  }

  const initialData: CompanyFormData = {
    legalName: company.legalName,
    displayNameZh: company.displayNameZh ?? undefined,
    displayNameEn: company.displayNameEn ?? undefined,
    ssmRegNo: company.ssmRegNo ?? undefined,
    industryCode: company.industryCode ?? undefined,
    size: company.size ?? undefined,
    website: company.website ?? undefined,
    state: company.state ?? undefined,
    city: company.city ?? undefined,
    address: company.address ?? undefined,
    description: company.description ?? undefined,
    logoKey: company.logoKey ?? undefined,
  }

  return (
    <div className="container mx-auto max-w-2xl px-4 py-12">
      <h1 className="text-2xl font-bold mb-2">{t('title')}</h1>
      <p className="text-muted-foreground mb-8">{t('subtitle')}</p>
      <CompanyForm
        mode="edit"
        industries={INDUSTRIES}
        locale={locale}
        initialData={initialData}
        companyId={company.id}
        onSubmit={updateCompanyAction}
      />
    </div>
  )
}
