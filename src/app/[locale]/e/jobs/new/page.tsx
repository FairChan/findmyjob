import { headers } from 'next/headers'
import { getTranslations } from 'next-intl/server'
import { requireCompanyMember } from '@/server/authz'
import { db } from '@/server/db'
import JobFormClient from '@/components/jobs/job-form-client'
import { createJobAction } from '../actions'
import { getCompanyEntitlementUsage } from '@/server/services/subscription-entitlements'
import { CompanyEntitlementSummary } from '@/components/billing/company-entitlement-summary'
import { getJdAssistantAvailability } from '@/server/services/jd-assistant'
import { WorkspacePage } from '@/components/layout/workspace-page'

export default async function NewJobPage({ params }: { params: Promise<{ locale: string }> }) {
  await params
  const h = await headers()
  const t = await getTranslations('jobs')

  const ctx = await requireCompanyMember('RECRUITER', h)
  const company = await db.company.findUnique({
    where: { id: ctx.companyId },
    select: { verificationStatus: true },
  })
  const isVerified = company?.verificationStatus === 'VERIFIED'
  const usage = await getCompanyEntitlementUsage(ctx)
  const jdAssistant = await getJdAssistantAvailability(ctx)

  return (
    <WorkspacePage title={t('newJobTitle')} width="list">
      <CompanyEntitlementSummary usage={usage} resource="jobs" />
      <JobFormClient
        canPurchase={usage.canPurchase}
        jdAssistant={jdAssistant ?? undefined}
        mode="create"
        isVerified={isVerified}
        onSaveOrSubmit={createJobAction}
        backHref="/e/jobs"
        t={{
          titleLabel: t('form.titleLabel'),
          titlePlaceholder: t('form.titlePlaceholder'),
          typeLabel: t('form.typeLabel'),
          typeInternship: t('type.INTERNSHIP'),
          typeFullTime: t('type.FULL_TIME'),
          typePartTime: t('type.PART_TIME'),
          categoryLabel: t('form.categoryLabel'),
          categoryPlaceholder: t('form.categoryPlaceholder'),
          descriptionLabel: t('form.descriptionLabel'),
          descriptionPlaceholder: t('form.descriptionPlaceholder'),
          requirementsLabel: t('form.requirementsLabel'),
          requirementsPlaceholder: t('form.requirementsPlaceholder'),
          benefitsLabel: t('form.benefitsLabel'),
          benefitsPlaceholder: t('form.benefitsPlaceholder'),
          workModeLabel: t('form.workModeLabel'),
          workModeOnsite: t('workMode.ONSITE'),
          workModeHybrid: t('workMode.HYBRID'),
          workModeRemote: t('workMode.REMOTE'),
          stateLabel: t('form.stateLabel'),
          statePlaceholder: t('form.statePlaceholder'),
          cityLabel: t('form.cityLabel'),
          cityPlaceholder: t('form.cityPlaceholder'),
          salaryMinLabel: t('form.salaryMinLabel'),
          salaryMaxLabel: t('form.salaryMaxLabel'),
          salaryVisibleLabel: t('form.salaryVisibleLabel'),
          languagesLabel: t('form.languagesLabel'),
          languagesPlaceholder: t('form.languagesPlaceholder'),
          skillsLabel: t('form.skillsLabel'),
          skillsPlaceholder: t('form.skillsPlaceholder'),
          acceptsStudentPassLabel: t('form.acceptsStudentPassLabel'),
          sponsorsWorkPassLabel: t('form.sponsorsWorkPassLabel'),
          headcountLabel: t('form.headcountLabel'),
          deadlineLabel: t('form.deadlineLabel'),
          saveDraft: t('form.saveDraft'),
          submitReview: t('form.submitReview'),
          saving: t('form.saving'),
          saveSuccess: t('form.saveSuccess'),
          submitSuccess: t('form.submitSuccess'),
          errorRequired: t('form.errorRequired'),
          errorForbidden: t('errorForbidden'),
          errorUnknown: t('errorUnknown'),
          verifiedOnly: t('form.verifiedOnly'),
          back: t('form.back'),
          removeTagLabel: t('form.removeTagLabel'),
        }}
      />
    </WorkspacePage>
  )
}
