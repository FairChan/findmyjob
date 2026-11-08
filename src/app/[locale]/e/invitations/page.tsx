import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { requireCompanyMember } from '@/server/authz'
import { ForbiddenError } from '@/server/errors'
import { listCompanyInvitations, getMonthlyInvitationUsage } from '@/server/services/invitations'
import { CompanyInvitationList } from '@/components/invitations/CompanyInvitationList'

export default async function EmployerInvitationsPage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  const t = await getTranslations('invitations')

  let ctx: { userId: string; companyId: string }
  try {
    ctx = await requireCompanyMember('RECRUITER', await headers())
  } catch (err) {
    if (err instanceof ForbiddenError) redirect(`/${locale}/e/onboarding`)
    throw err
  }

  const [invitations, usage] = await Promise.all([
    listCompanyInvitations(ctx),
    getMonthlyInvitationUsage(ctx.companyId),
  ])

  return (
    <main id="main-content" className="container mx-auto max-w-3xl px-4 py-8">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold">{t('companyInvitationsTitle')}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {t('companyInvitationsSubtitle', { used: usage.used, quota: usage.quota })}
          </p>
        </div>
      </div>
      <CompanyInvitationList invitations={invitations} locale={locale} />
    </main>
  )
}
