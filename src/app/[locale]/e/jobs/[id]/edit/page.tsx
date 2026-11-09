import { headers } from 'next/headers'
import { notFound } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { requireCompanyMember } from '@/server/authz'
import { getCompanyJob } from '@/server/services/jobs'
import { db } from '@/server/db'
import JobFormClient from '@/components/jobs/job-form-client'
import { updateJobAction } from '../../actions'
import { NotFoundError } from '@/server/errors'
import { getCompanyEntitlementUsage } from '@/server/services/subscription-entitlements'
import { CompanyEntitlementSummary } from '@/components/billing/company-entitlement-summary'

export default async function EditJobPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>
}) {
  const { id } = await params
  const h = await headers()
  const t = await getTranslations('jobs')

  const ctx = await requireCompanyMember('RECRUITER', h)

  let job: Awaited<ReturnType<typeof getCompanyJob>>
  try {
    job = await getCompanyJob(ctx, id)
  } catch (err) {
    if (err instanceof NotFoundError) return notFound()
    throw err
  }

  const company = await db.company.findUnique({
    where: { id: ctx.companyId },
    select: { verificationStatus: true },
  })
  const isVerified = company?.verificationStatus === 'VERIFIED'
  const usage = await getCompanyEntitlementUsage(ctx)

  const initialData = {
    jobId: job.id,
    title: job.title,
    type: job.type,
    category: job.category ?? undefined,
    description: job.description,
    requirements: job.requirements ?? undefined,
    benefits: job.benefits ?? undefined,
    workMode: job.workMode,
    state: job.state ?? undefined,
    city: job.city ?? undefined,
    salaryMin: job.salaryMin ?? undefined,
    salaryMax: job.salaryMax ?? undefined,
    salaryVisible: job.salaryVisible,
    languages: job.languages,
    skills: job.skills,
    acceptsStudentPass: job.acceptsStudentPass,
    sponsorsWorkPass: job.sponsorsWorkPass,
    headcount: job.headcount ?? undefined,
    deadline: job.deadline?.toISOString() ?? undefined,
    updatedAt: job.updatedAt.toISOString(),
  }

  const isEditable = job.status !== 'CLOSED'

  return (
    <div className="container mx-auto max-w-3xl px-4 py-8">
      <div className="mb-2 flex items-center gap-3">
        <h1 className="text-2xl font-bold">{t('editJobTitle')}</h1>
        <span className="rounded-full bg-muted px-3 py-1 text-xs font-medium">
          {t(`status.${job.status}`)}
        </span>
      </div>
      {!isEditable && (
        <p className="mb-4 rounded bg-muted p-3 text-sm text-muted-foreground">
          {t('notEditable')}
        </p>
      )}
      <CompanyEntitlementSummary usage={usage} resource="jobs" />
      <JobFormClient
        canPurchase={usage.canPurchase}
        mode="edit"
        isVerified={isVerified}
        isEditable={isEditable}
        initialData={initialData}
        onSaveOrSubmit={updateJobAction}
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
    </div>
  )
}
