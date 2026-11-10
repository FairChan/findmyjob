import 'server-only'
import { notFound, redirect } from 'next/navigation'
import { headers } from 'next/headers'
import { getTranslations } from 'next-intl/server'
import Link from 'next/link'
import type { DegreeLevel, ExperienceKind } from '@prisma/client'
import { requireCompanyMember } from '@/server/authz'
import { ForbiddenError, NotFoundError, RateLimitedError } from '@/server/errors'
import { db } from '@/server/db'
import { viewTalentProfile } from '@/server/services/talent-view'
import { getSetting } from '@/server/services/settings'
import { getValidatedUnlockSettings } from '@/server/services/unlock'
import type { TalentDetail, TalentEducation, TalentExperience } from '@/server/serializers/talent-card'
import { Button } from '@/components/ui/button'
import { SaveToFolderButton } from '@/components/talent/SaveToFolderButton'
import { UnlockButton, type UnlockCreditsAdvice } from '@/components/talent/UnlockButton'
import { InviteButton } from '@/components/invitations/InviteButton'
import { getCompanyEntitlementUsage } from '@/server/services/subscription-entitlements'

// ---- Label maps ----

const DEGREE_LABELS: Record<DegreeLevel, string> = {
  FOUNDATION: 'degreeLevelFoundation',
  DIPLOMA: 'degreeLevelDiploma',
  BACHELOR: 'degreeLevelBachelor',
  MASTER: 'degreeLevelMaster',
  PHD: 'degreeLevelPhd',
}

const EXP_KIND_LABELS: Record<ExperienceKind, string> = {
  INTERNSHIP: 'expKindInternship',
  WORK: 'expKindWork',
  PROJECT: 'expKindProject',
  CAMPUS: 'expKindCampus',
  AWARD: 'expKindAward',
}

// ---- Date format ----

function formatYearMonth(date: Date | null): string {
  if (!date) return ''
  const y = date.getUTCFullYear()
  const m = String(date.getUTCMonth() + 1).padStart(2, '0')
  return `${y}-${m}`
}

// ---- Education section ----

function EducationList({
  educations,
  tLabel,
}: {
  educations: TalentEducation[]
  tLabel: (key: string) => string
}) {
  if (educations.length === 0) return null
  return (
    <section aria-labelledby="edu-heading">
      <h2 id="edu-heading" className="mb-3 text-base font-semibold">
        {tLabel('sectionEducation')}
      </h2>
      <ul className="space-y-3">
        {educations.map((edu) => (
          <li key={edu.id} className="rounded-lg border bg-card p-3">
            <p className="font-medium">{edu.schoolName}</p>
            {(edu.degreeLevel || edu.major) && (
              <p className="mt-0.5 text-sm text-muted-foreground">
                {edu.degreeLevel ? tLabel(DEGREE_LABELS[edu.degreeLevel]) : ''}
                {edu.degreeLevel && edu.major ? ' · ' : ''}
                {edu.major ?? ''}
              </p>
            )}
            {(edu.startDate || edu.endDate) && (
              <p className="mt-0.5 text-xs text-muted-foreground">
                {formatYearMonth(edu.startDate)}
                {edu.startDate && edu.endDate ? ' – ' : ''}
                {formatYearMonth(edu.endDate)}
              </p>
            )}
            {edu.description && (
              <p className="mt-1 text-sm">{edu.description}</p>
            )}
          </li>
        ))}
      </ul>
    </section>
  )
}

// ---- Experience section ----

function ExperienceList({
  experiences,
  tLabel,
}: {
  experiences: TalentExperience[]
  tLabel: (key: string) => string
}) {
  if (experiences.length === 0) return null
  return (
    <section aria-labelledby="exp-heading">
      <h2 id="exp-heading" className="mb-3 text-base font-semibold">
        {tLabel('sectionExperience')}
      </h2>
      <ul className="space-y-3">
        {experiences.map((exp) => (
          <li key={exp.id} className="rounded-lg border bg-card p-3">
            <div className="flex flex-wrap items-center gap-x-2">
              <p className="font-medium">{exp.title}</p>
              <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                {tLabel(EXP_KIND_LABELS[exp.kind])}
              </span>
            </div>
            {exp.organization && (
              <p className="mt-0.5 text-sm text-muted-foreground">{exp.organization}</p>
            )}
            {(exp.startDate || exp.endDate) && (
              <p className="mt-0.5 text-xs text-muted-foreground">
                {formatYearMonth(exp.startDate)}
                {exp.startDate && exp.endDate ? ' – ' : ''}
                {formatYearMonth(exp.endDate)}
              </p>
            )}
            {exp.description && (
              <p className="mt-1 text-sm">{exp.description}</p>
            )}
          </li>
        ))}
      </ul>
    </section>
  )
}

// ---- Detail body ----

interface InviteJob {
  id: string
  title: string
}

function TalentDetailBody({
  detail,
  locale,
  tLabel,
  tFolders,
  costCredits,
  unlockEnabled,
  billingEnabled,
  insufficientCreditsAdvice,
  inviteJobs,
  inviteUsed,
  inviteQuota,
  canPurchase,
}: {
  detail: TalentDetail
  locale: string
  tLabel: (key: string, values?: Record<string, string | number>) => string
  tFolders: (key: string) => string
  costCredits: number
  unlockEnabled: boolean
  billingEnabled: boolean
  insufficientCreditsAdvice?: UnlockCreditsAdvice
  inviteJobs: InviteJob[]
  inviteUsed: number
  inviteQuota: number | null
  canPurchase: boolean
}) {
  return (
    <div className="space-y-6">
      {/* Header card */}
      <div className="rounded-lg border bg-card p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <h1 className="text-xl font-bold">{detail.name}</h1>
              {detail.unlocked && (
                <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">
                  {tLabel('unlocked')}
                </span>
              )}
            </div>
            {detail.headline && (
              <p className="mt-1 text-sm text-muted-foreground">{detail.headline}</p>
            )}
            {(detail.school || detail.major) && (
              <p className="mt-1 text-sm text-muted-foreground">
                {detail.school
                  ? locale === 'zh'
                    ? detail.school.nameZh
                    : detail.school.nameEn
                  : null}
                {detail.school && detail.major ? ' · ' : ''}
                {detail.major ?? ''}
              </p>
            )}
            {(detail.degreeLevel || detail.graduationYear) && (
              <p className="mt-0.5 text-sm text-muted-foreground">
                {detail.degreeLevel ? tLabel(DEGREE_LABELS[detail.degreeLevel]) : ''}
                {detail.degreeLevel && detail.graduationYear ? ' · ' : ''}
                {detail.graduationYear ?? ''}
              </p>
            )}
          </div>

          {/* Save to folder button */}
          <div className="flex flex-col items-end gap-2">
            <SaveToFolderButton
              studentId={detail.id}
              labels={{
                save: tFolders('saveButton'),
                saveToFolder: tFolders('saveToFolder'),
                noFolders: tFolders('noFoldersHint'),
                createNew: tFolders('createFolder'),
                folderNamePlaceholder: tFolders('folderNamePlaceholder'),
                create: tFolders('create'),
                added: tFolders('added'),
                remove: tFolders('remove'),
                close: tFolders('cancel'),
                loading: tFolders('loading'),
                errorOccurred: tFolders('errorOccurred'),
              }}
            />
            {!detail.unlocked && unlockEnabled && (
              <UnlockButton
                studentId={detail.id}
                insufficientCreditsAdvice={insufficientCreditsAdvice}
                labels={{
                  button: tLabel('unlockButton', { cost: costCredits }),
                  confirmTitle: tLabel('unlockConfirmTitle'),
                  confirmDesc: tLabel('unlockConfirmDesc'),
                  confirmCost: tLabel('unlockConfirmCost', { cost: costCredits }),
                  confirmOk: tLabel('unlockConfirmOk'),
                  confirmCancel: tLabel('unlockConfirmCancel'),
                  errorInsufficient: tLabel(billingEnabled ? 'unlockErrorInsufficient' : 'unlockErrorInsufficientPilot'),
                  errorRateLimit: tLabel('unlockErrorRateLimit'),
                  errorGeneric: tLabel('unlockErrorGeneric'),
                }}
              />
            )}
            <InviteButton
              studentId={detail.id}
              jobs={inviteJobs}
              usedQuota={inviteUsed}
              totalQuota={inviteQuota}
              canPurchase={canPurchase}
            />
          </div>
        </div>

        {/* Skills */}
        {detail.skills.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {detail.skills.map((skill) => (
              <span
                key={skill}
                className="rounded-full bg-blue-50 px-2 py-0.5 text-xs text-blue-700"
              >
                {skill}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Summary */}
      {detail.summary && (
        <section aria-labelledby="summary-heading">
          <h2 id="summary-heading" className="mb-2 text-base font-semibold">
            {tLabel('sectionSummary')}
          </h2>
          <p className="text-sm">{detail.summary}</p>
        </section>
      )}

      <EducationList educations={detail.educations} tLabel={tLabel} />
      <ExperienceList experiences={detail.experiences} tLabel={tLabel} />

      {/* Contact details — only shown when unlocked */}
      {detail.unlocked && detail.contact && (
        <section aria-labelledby="contact-heading">
          <h2 id="contact-heading" className="mb-3 text-base font-semibold">
            {tLabel('sectionContact')}
          </h2>
          <div className="rounded-lg border bg-card p-4 space-y-2 text-sm">
            {detail.contact.phone && (
              <div className="flex gap-2">
                <span className="w-20 shrink-0 text-muted-foreground">{tLabel('contactPhone')}</span>
                <span className="font-medium">{detail.contact.phone}</span>
              </div>
            )}
            {detail.contact.email && (
              <div className="flex gap-2">
                <span className="w-20 shrink-0 text-muted-foreground">{tLabel('contactEmail')}</span>
                <a href={`mailto:${detail.contact.email}`} className="font-medium underline underline-offset-2">
                  {detail.contact.email}
                </a>
              </div>
            )}
            {detail.contact.whatsapp && (
              <div className="flex gap-2">
                <span className="w-20 shrink-0 text-muted-foreground">{tLabel('contactWhatsapp')}</span>
                <span className="font-medium">{detail.contact.whatsapp}</span>
              </div>
            )}
            {detail.contact.wechat && (
              <div className="flex gap-2">
                <span className="w-20 shrink-0 text-muted-foreground">{tLabel('contactWechat')}</span>
                <span className="font-medium">{detail.contact.wechat}</span>
              </div>
            )}
            {detail.contact.linkedinUrl && (
              <div className="flex gap-2">
                <span className="w-20 shrink-0 text-muted-foreground">{tLabel('contactLinkedin')}</span>
                <a
                  href={detail.contact.linkedinUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-medium underline underline-offset-2"
                >
                  {detail.contact.linkedinUrl}
                </a>
              </div>
            )}
          </div>
        </section>
      )}

      {/* Resume download */}
      {detail.resumeCount > 0 && (
        <section aria-labelledby="resume-heading">
          <h2 id="resume-heading" className="mb-2 text-base font-semibold">
            {tLabel('sectionResume')}
          </h2>
          {detail.unlocked && detail.resumeIds.length > 0 ? (
            <ul className="space-y-2">
              {detail.resumeIds.map((resumeId, idx) => (
                <li key={resumeId}>
                  <a
                    href={`/api/resumes/${resumeId}/download`}
                    download="resume.pdf"
                    className="inline-flex min-h-[44px] min-w-[44px] items-center gap-2 rounded-md border bg-card px-4 py-2 text-sm font-medium hover:bg-accent hover:text-accent-foreground"
                    data-testid={`resume-download-${idx}`}
                  >
                    {tLabel('resumeDownload')}
                  </a>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">
              {detail.unlocked
                ? tLabel('resumeUnlockedHint')
                : tLabel('resumeLockedHint')}
            </p>
          )}
        </section>
      )}
    </div>
  )
}

// ---- Main page ----

export default async function TalentDetailPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>
}) {
  const { locale, id } = await params
  const t = await getTranslations('talentDetail')
  const tLabel = (key: string, values?: Record<string, string | number>) =>
    values
      ? (t as (k: string, v: Record<string, string | number>) => string)(key, values)
      : t(key as Parameters<typeof t>[0])
  const tFoldersMsg = await getTranslations('talentFolders')
  const tFolders = (key: string) => tFoldersMsg(key as Parameters<typeof tFoldersMsg>[0])

  let ctx: Awaited<ReturnType<typeof requireCompanyMember>>
  try {
    ctx = await requireCompanyMember('RECRUITER', await headers())
  } catch (err) {
    if (err instanceof ForbiddenError) redirect(`/${locale}/e/onboarding`)
    throw err
  }

  const company = await db.company.findUnique({
    where: { id: ctx.companyId },
    select: { verificationStatus: true },
  })

  if (company?.verificationStatus !== 'VERIFIED') {
    return (
      <div className="container mx-auto max-w-2xl px-4 py-12">
        <div
          role="alert"
          className="rounded-lg border border-amber-200 bg-amber-50 p-8 text-center"
        >
          <h1 className="text-xl font-semibold text-amber-900">{tLabel('verifyRequired')}</h1>
          <p className="mt-2 text-sm text-amber-700">{tLabel('verifyDesc')}</p>
          <Button asChild className="mt-6">
            <Link href={`/${locale}/e/onboarding`}>{tLabel('verifyAction')}</Link>
          </Button>
        </div>
      </div>
    )
  }

  const [unlockSettings, unlockEnabled, billingSetting, inviteUsage] = await Promise.all([
    getValidatedUnlockSettings(),
    getSetting<boolean>('unlock.enabled', true),
    getSetting<unknown>('billing.enabled', false, { fresh: true }),
    getCompanyEntitlementUsage(ctx),
  ])
  const billingEnabled = billingSetting === true
  const insufficientCreditsAdvice: UnlockCreditsAdvice | undefined = billingEnabled
    ? ctx.role === 'OWNER'
      ? { text: tLabel('unlockPurchaseCredits'), href: `/${locale}/e/billing` }
      : { text: tLabel('unlockAskOwnerToPurchase') }
    : undefined

  // Fetch published jobs for this company (for the invite dialog)
  const now = new Date()
  const publishedJobs = await db.job.findMany({
    where: {
      companyId: ctx.companyId,
      status: 'PUBLISHED',
      OR: [{ deadline: null }, { deadline: { gt: now } }],
    },
    select: { id: true, title: true },
    orderBy: { publishedAt: 'desc' },
  })

  let detail: TalentDetail
  try {
    detail = await viewTalentProfile({ userId: ctx.userId, companyId: ctx.companyId }, id)
  } catch (err) {
    if (err instanceof NotFoundError) notFound()
    if (err instanceof RateLimitedError) {
      return (
        <div className="container mx-auto max-w-2xl px-4 py-12">
          <div
            role="alert"
            className="rounded-lg border p-8 text-center text-muted-foreground"
          >
            <p className="font-medium">{tLabel('limitReached')}</p>
            <p className="mt-1 text-sm">{tLabel('limitReachedDesc')}</p>
            <Button asChild variant="outline" className="mt-6">
              <Link href={`/${locale}/e/talent`}>{tLabel('backToSearch')}</Link>
            </Button>
          </div>
        </div>
      )
    }
    throw err
  }

  return (
    <div className="container mx-auto max-w-3xl px-4 py-6">
      <nav aria-label="breadcrumb" className="mb-4">
        <Button asChild variant="ghost" size="sm" className="-ml-2">
          <Link href={`/${locale}/e/talent`} prefetch={false}>
            ← {tLabel('backToSearch')}
          </Link>
        </Button>
      </nav>

      <TalentDetailBody
        detail={detail}
        locale={locale}
        tLabel={tLabel}
        tFolders={tFolders}
        costCredits={unlockSettings.costCredits}
        unlockEnabled={unlockEnabled}
        billingEnabled={billingEnabled}
        insufficientCreditsAdvice={insufficientCreditsAdvice}
        inviteJobs={publishedJobs}
        inviteUsed={inviteUsage.invitations.used}
        inviteQuota={inviteUsage.invitations.limit}
        canPurchase={inviteUsage.canPurchase}
      />
    </div>
  )
}
