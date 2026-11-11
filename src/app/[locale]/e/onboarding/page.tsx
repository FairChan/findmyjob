import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { requireEmployer } from '@/server/authz'
import { getMyCompany } from '@/server/services/company'
import { INDUSTRIES } from '@/server/lib/taxonomy/industries'
import { createCompanyAction } from '@/server/actions/company'
import CompanyForm from '@/components/company/company-form'
import { WorkspacePage } from '@/components/layout/workspace-page'

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
    <WorkspacePage title={t('title')} lead={t('subtitle')}>
      <CompanyForm
        mode="create"
        industries={INDUSTRIES}
        locale={locale}
        onSubmit={createCompanyAction}
      />
    </WorkspacePage>
  )
}
