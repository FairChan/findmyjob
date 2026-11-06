import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { requireEmployer } from '@/server/authz'
import { getMyCompany } from '@/server/services/company'
import { INDUSTRIES } from '@/server/lib/taxonomy/industries'
import { createCompanyAction } from '@/server/actions/company'
import CompanyForm from '@/components/company/company-form'

export default async function EmployerOnboardingPage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  const t = await getTranslations('companyOnboarding')

  const ctx = await requireEmployer(await headers())
  const existing = await getMyCompany(ctx)

  // Already has a company — go to edit page
  if (existing) {
    redirect(`/${locale}/e/company`)
  }

  return (
    <div className="container mx-auto max-w-2xl px-4 py-12">
      <h1 className="text-2xl font-bold mb-2">{t('title')}</h1>
      <p className="text-muted-foreground mb-8">{t('subtitle')}</p>
      <CompanyForm
        mode="create"
        industries={INDUSTRIES}
        locale={locale}
        onSubmit={createCompanyAction}
      />
    </div>
  )
}
