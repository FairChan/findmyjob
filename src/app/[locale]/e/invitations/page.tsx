import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { requireCompanyMember } from '@/server/authz'
import { ForbiddenError } from '@/server/errors'
import { listCompanyInvitations } from '@/server/services/invitations'
import { getCompanyEntitlementUsage } from '@/server/services/subscription-entitlements'
import { CompanyEntitlementSummary } from '@/components/billing/company-entitlement-summary'
import { CompanyInvitationList } from '@/components/invitations/CompanyInvitationList'
import { WorkspacePage } from '@/components/layout/workspace-page'

export default async function EmployerInvitationsPage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  const t = await getTranslations('invitations')

  let ctx: Awaited<ReturnType<typeof requireCompanyMember>>
  try {
    ctx = await requireCompanyMember('RECRUITER', await headers())
  } catch (err) {
    if (err instanceof ForbiddenError) redirect(`/${locale}/e/onboarding`)
    throw err
  }

  const [invitations, usage] = await Promise.all([
    listCompanyInvitations(ctx),
    getCompanyEntitlementUsage(ctx),
  ])

  return (
    <WorkspacePage title={t('companyInvitationsTitle')} width="list">
      <CompanyEntitlementSummary usage={usage} resource="invitations" />
      <CompanyInvitationList invitations={invitations} locale={locale} />
    </WorkspacePage>
  )
}
