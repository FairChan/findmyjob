import type React from 'react'
import { z } from 'zod'
import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'
import { headers } from 'next/headers'
import { getTranslations } from 'next-intl/server'
import { Link } from '@/i18n/navigation'
import { db } from '@/server/db'
import { getSession } from '@/server/auth'
import { openJob } from '@/server/services/job-view-quota'
import { toJobDetail } from '@/server/serializers/job'
import { stateLabel } from '@/lib/my-states'
import { ShareJobButton } from './ShareJobButton'
import { ReportJobDialog } from '@/components/jobs/report-job-dialog'
import { ApplyModal, AppliedStatus, WithdrawnStatus } from '@/components/apply/ApplyModal'
import { getSetting } from '@/server/services/settings'

const jobIdSchema = z.string().cuid()

interface PageProps {
  params: Promise<{ locale: string; id: string }>
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { id: rawId } = await params
  if (!jobIdSchema.safeParse(rawId).success) return {}
  const job = await db.job.findUnique({
    where: { id: rawId, status: 'PUBLISHED' },
    select: { title: true },
  })
  if (!job) return {}
  return {
    title: job.title,
    robots: { index: false, follow: true },
  }
}

export default async function JobDetailPage({ params }: PageProps) {
  const { locale, id: rawId } = await params
  const idParsed = jobIdSchema.safeParse(rawId)
  if (!idParsed.success) return notFound()
  const id = idParsed.data
  const h = await headers()
  const t = await getTranslations('publicJobs')

  const now = new Date()
  const job = await db.job.findUnique({
    where: { id },
    select: {
      id: true,
      title: true,
      type: true,
      category: true,
      workMode: true,
      state: true,
      city: true,
      salaryMin: true,
      salaryMax: true,
      salaryVisible: true,
      description: true,
      requirements: true,
      benefits: true,
      languages: true,
      skills: true,
      acceptsStudentPass: true,
      sponsorsWorkPass: true,
      headcount: true,
      deadline: true,
      publishedAt: true,
      viewCount: true,
      status: true,
      companyId: true,
      company: {
        select: {
          id: true,
          displayNameZh: true,
          displayNameEn: true,
          legalName: true,
          isActive: true,
        },
      },
    },
  })

  // Only published, not past deadline, and company must be active
  if (
    !job ||
    job.status !== 'PUBLISHED' ||
    (job.deadline !== null && job.deadline <= now) ||
    !job.company.isActive
  ) {
    return notFound()
  }

  const session = await getSession(h)

  // Visitors must log in to see detail
  if (!session?.user) {
    redirect(`/${locale}/login?redirect=/${locale}/jobs/${id}`)
  }

  // Re-query to get current role/status (session may be stale)
  const dbUser = await db.user.findUnique({
    where: { id: session.user.id },
    select: { id: true, role: true, status: true },
  })
  if (!dbUser || dbUser.status !== 'ACTIVE') {
    redirect(`/${locale}/login`)
  }

  const companyName =
    locale === 'zh'
      ? (job.company.displayNameZh ?? job.company.legalName)
      : (job.company.displayNameEn ?? job.company.legalName)

  // Employer viewing another company's job → locked card
  if (dbUser.role === 'EMPLOYER') {
    const member = await db.companyMember.findFirst({
      where: { userId: dbUser.id },
      select: { companyId: true },
    })
    const isOwnCompany = member?.companyId === job.companyId
    if (!isOwnCompany) {
      return <LockedJobCard title={job.title} companyName={companyName} state={job.state} t={t} jobId={id} />
    }
  }

  // Student: use quota check
  let applySection: React.ReactNode = null
  if (dbUser.role === 'STUDENT') {
    const studentProfile = await db.studentProfile.findUnique({
      where: { userId: dbUser.id },
      select: {
        id: true,
        completeness: true,
        onboardingStep: true,
        resumes: {
          select: { id: true, fileName: true, isPrimary: true },
          orderBy: [{ isPrimary: 'desc' }, { createdAt: 'desc' }],
        },
      },
    })
    if (!studentProfile) {
      redirect(`/${locale}/s/onboarding`)
    }

    const { allowed, isNewView } = await openJob(studentProfile.id, id)

    if (!allowed) {
      return <LockedJobCard title={job.title} companyName={companyName} state={job.state} t={t} jobId={id} />
    }

    // Only increment viewCount on first open — not on repeat visits
    if (isNewView) {
      db.job.update({ where: { id }, data: { viewCount: { increment: 1 } } }).catch(() => {})
    }

    // Apply section: show apply modal, already-applied badge, or complete-profile prompt
    const minCompleteness = await getSetting<number>('apply.minCompleteness', 60)
    const incompleteStepPath =
      studentProfile.completeness < minCompleteness
        ? studentProfile.onboardingStep < 5
          ? `/${locale}/s/onboarding`
          : `/${locale}/s/resume`
        : null

    const existing = await db.application.findUnique({
      where: { jobId_studentId: { jobId: id, studentId: studentProfile.id } },
      select: { id: true, status: true },
    })

    if (existing && existing.status !== 'WITHDRAWN') {
      applySection = <AppliedStatus applicationId={existing.id} />
    } else if (existing?.status === 'WITHDRAWN') {
      applySection = <WithdrawnStatus />
    } else {
      applySection = (
        <ApplyModal
          jobId={id}
          resumes={studentProfile.resumes}
          locale={locale}
          incompleteStepPath={incompleteStepPath}
        />
      )
    }
  }

  // Admin sees full detail but does not count as a job view

  const detail = toJobDetail(job)

  return (
    <div className="container mx-auto max-w-3xl px-4 py-8">
      <div className="mb-4">
        <Link href="/jobs" className="text-sm text-muted-foreground hover:text-foreground">
          ← {t('backToList')}
        </Link>
      </div>

      <article>
        <h1 className="text-2xl font-bold mb-1">{detail.title}</h1>
        <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground mb-4">
          <span>{companyName}</span>
          {detail.state && <span>· {stateLabel(detail.state, locale)}</span>}
          {detail.city && <span>· {detail.city}</span>}
          <span>· {t(`type.${detail.type}`)}</span>
          <span>· {t(`workMode.${detail.workMode}`)}</span>
        </div>

        {applySection && (
          <div className="mb-6">
            {applySection}
          </div>
        )}

        {(detail.salaryMin != null || detail.salaryMax != null) && (
          <p className="font-medium text-brand mb-4">
            {detail.salaryMin != null && detail.salaryMax != null
              ? `MYR ${detail.salaryMin.toLocaleString()} – ${detail.salaryMax.toLocaleString()}`
              : detail.salaryMin != null
                ? `MYR ${detail.salaryMin.toLocaleString()}+`
                : `≤ MYR ${detail.salaryMax!.toLocaleString()}`}
          </p>
        )}

        <div className="flex flex-wrap gap-1.5 mb-6">
          {detail.skills.map((s) => (
            <span key={s} className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium">
              {s}
            </span>
          ))}
        </div>

        <section className="mb-6">
          <h2 className="text-base font-semibold mb-2">{t('descriptionLabel')}</h2>
          <p className="text-sm leading-relaxed whitespace-pre-wrap">{detail.description}</p>
        </section>

        {detail.requirements && (
          <section className="mb-6">
            <h2 className="text-base font-semibold mb-2">{t('requirementsLabel')}</h2>
            <p className="text-sm leading-relaxed whitespace-pre-wrap">{detail.requirements}</p>
          </section>
        )}

        {detail.benefits && (
          <section className="mb-6">
            <h2 className="text-base font-semibold mb-2">{t('benefitsLabel')}</h2>
            <p className="text-sm leading-relaxed whitespace-pre-wrap">{detail.benefits}</p>
          </section>
        )}
      </article>
      <div className="flex flex-wrap items-start gap-x-3">
        <ShareJobButton jobId={id} label={t('shareJobLabel')} copiedLabel={t('shareJobCopied')} />
        <ReportJobDialog jobId={id} />
      </div>
    </div>
  )
}

function LockedJobCard({
  title,
  companyName,
  state,
  t,
  jobId,
}: {
  title: string
  companyName: string
  state: string | null
  t: Awaited<ReturnType<typeof getTranslations<'publicJobs'>>>
  jobId: string
}) {
  return (
    <div className="container mx-auto max-w-3xl px-4 py-8">
      <div className="mb-4">
        <Link href="/jobs" className="text-sm text-muted-foreground hover:text-foreground">
          ← {t('backToList')}
        </Link>
      </div>
      <div className="rounded-lg border bg-card p-6">
        <h1 className="text-2xl font-bold mb-1">{title}</h1>
        <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground mb-6">
          <span>{companyName}</span>
          {state && <span>· {state}</span>}
        </div>
        <div className="rounded-md bg-muted/60 border border-dashed p-6 text-center">
          <p className="text-sm font-medium mb-1">{t('lockedTitle')}</p>
          <p className="text-sm text-muted-foreground mb-4">{t('lockedDesc')}</p>
          <Link
            href="/s/invite"
            className="inline-flex items-center rounded-md bg-brand px-4 py-2 text-sm font-semibold text-brand-foreground hover:bg-brand/90 transition-colors min-h-[24px]"
          >
            {t('inviteButton')}
          </Link>
        </div>
        <div className="flex flex-wrap items-start gap-x-3">
          <ShareJobButton jobId={jobId} label={t('shareJobLabel')} copiedLabel={t('shareJobCopied')} />
          <ReportJobDialog jobId={jobId} />
        </div>
      </div>
    </div>
  )
}

