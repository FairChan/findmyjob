import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { requireCompanyMember } from '@/server/authz'
import { getMyCompany } from '@/server/services/company'
import { listTeamMembers } from '@/server/services/team'
import TeamPageClient from '@/components/team/team-page-client'
import { getCompanyEntitlementUsage } from '@/server/services/subscription-entitlements'
import { CompanyEntitlementSummary } from '@/components/billing/company-entitlement-summary'

export default async function TeamPage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  const t = await getTranslations('team')

  const ctx = await requireCompanyMember('RECRUITER', await headers())
  const company = await getMyCompany({ userId: ctx.userId })

  if (!company) {
    redirect(`/${locale}/e/onboarding`)
  }

  const [members, usage] = await Promise.all([listTeamMembers(ctx), getCompanyEntitlementUsage(ctx)])

  const translations = {
    invite: t('invite'),
    emailLabel: t('emailLabel'),
    emailPlaceholder: t('emailPlaceholder'),
    roleLabel: t('roleLabel'),
    roleAdmin: t('roleAdmin'),
    roleRecruiter: t('roleRecruiter'),
    inviteSubmit: t('inviteSubmit'),
    inviteSent: t('inviteSent'),
    memberName: t('memberName'),
    memberEmail: t('memberEmail'),
    memberRole: t('memberRole'),
    roleOwner: t('roleOwner'),
    removeButton: t('removeButton'),
    changeRoleButton: t('changeRoleButton'),
    confirmRemove: t('confirmRemove'),
    cancelButton: t('cancelButton'),
    errorForbidden: t('errorForbidden'),
    errorLimitReached: t('errorLimitReached'),
    errorAlreadyMember: t('errorAlreadyMember'),
    errorUnknown: t('errorUnknown'),
  }

  return (
    <div className="container mx-auto max-w-3xl px-4 py-12">
      <h1 className="mb-2 text-2xl font-bold">{t('title')}</h1>
      <p className="mb-8 text-muted-foreground">{t('subtitle')}</p>
      <CompanyEntitlementSummary usage={usage} resource="seats" />
      <TeamPageClient
        canPurchase={usage.canPurchase}
        members={members}
        currentUserId={ctx.userId}
        currentRole={ctx.role}
        t={translations}
      />
    </div>
  )
}
