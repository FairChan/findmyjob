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
import { ShareJobButton } from '@/app/[locale]/(public)/jobs/[id]/ShareJobButton'
import { ReportJobDialog } from '@/components/jobs/report-job-dialog'
import { ApplyModal, AppliedStatus, WithdrawnStatus } from '@/components/apply/ApplyModal'
import { getSetting } from '@/server/services/settings'
import { getApplicationBlocker } from '@/lib/application-readiness'
import { hasStudentContact } from '@/server/services/contact-access'
import { ChevronLeft, LockKeyhole } from 'lucide-react'
import { formatKLDate } from '@/lib/format-date'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import { JobSharedTitle } from './job-browser-motion'

const jobIdSchema = z.string().cuid()

interface PageProps {
  params: Promise<{ locale: string; id: string }>
  listHref?: string
  presentation?: 'page' | 'modal'
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

export default async function JobDetailPage({ params, listHref = '/jobs', presentation = 'page' }: PageProps) {
  const modal = presentation === 'modal'
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
      return <LockedJobCard title={job.title} companyName={companyName} state={job.state} locale={locale} t={t} jobId={id} listHref={listHref} presentation={presentation} />
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
      return <LockedJobCard title={job.title} companyName={companyName} state={job.state} locale={locale} t={t} jobId={id} listHref={listHref} presentation={presentation} />
    }

    // Only increment viewCount on first open — not on repeat visits
    if (isNewView) {
      db.job.update({ where: { id }, data: { viewCount: { increment: 1 } } }).catch(() => {})
    }

    // Apply section: show apply modal, already-applied badge, or complete-profile prompt
    const minCompleteness = await getSetting<number>('apply.minCompleteness', 60)
    const blocker = getApplicationBlocker({
      hasContact: await hasStudentContact(studentProfile.id),
      hasResume: studentProfile.resumes.length > 0,
      completeness: studentProfile.completeness,
    }, minCompleteness)
    const incompleteStepPath = blocker
      ? blocker === 'profile' && studentProfile.onboardingStep >= 5
        ? `/${locale}/s/profile`
        : `/${locale}/s/onboarding`
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
          blocker={blocker}
        />
      )
    }
  }

  // Admin sees full detail but does not count as a job view

  const detail = toJobDetail(job)

  const salary =
    detail.salaryMin != null && detail.salaryMax != null
      ? `MYR ${detail.salaryMin.toLocaleString()} – ${detail.salaryMax.toLocaleString()}`
      : detail.salaryMin != null
        ? `MYR ${detail.salaryMin.toLocaleString()}+`
        : detail.salaryMax != null
          ? `≤ MYR ${detail.salaryMax.toLocaleString()}`
          : null
  const location = [detail.city, detail.state ? stateLabel(detail.state, locale) : null]
    .filter(Boolean)
    .join(', ')

  return (
    <div className={modal ? 'min-w-0' : 'page-shell pb-20 pt-8 md:pt-12'}>
      {!modal && <BackToJobs label={t('backToList')} href={listHref} />}

      <article className={cn('lg:grid', modal ? 'lg:grid-cols-[minmax(0,1fr)_18rem] lg:gap-x-8' : 'mt-6 lg:grid-cols-[minmax(0,1fr)_20rem] lg:gap-x-14')}>
        <header className="lg:col-start-1">
          <Link href={listHref === '/s/jobs' ? `/s/companies?company=${job.companyId}` : `/companies/${job.companyId}`} prefetch={false} className="text-body text-muted-foreground hover:text-brand">{companyName}</Link>
          <h1 className={cn('mt-2 text-balance', modal ? 'text-title leading-snug sm:text-3xl' : 'text-headline')}>
            {modal ? <JobSharedTitle jobId={id}>{detail.title}</JobSharedTitle> : detail.title}
          </h1>
          {(detail.acceptsStudentPass || detail.sponsorsWorkPass) && (
            <div className="mt-5 flex flex-wrap gap-2">
              {detail.acceptsStudentPass && <Badge tone="success">{t('facts.studentPass')}</Badge>}
              {detail.sponsorsWorkPass && <Badge tone="brand">{t('facts.workPass')}</Badge>}
            </div>
          )}
        </header>

        {/* On small screens the action sits right under the title; on large ones it stays in view while reading. */}
        <aside className="mt-8 lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:mt-0">
          <Card className={modal ? 'lg:sticky lg:top-0' : 'lg:sticky lg:top-20'}>
            <p className="text-xs text-muted-foreground">{t('facts.salary')}</p>
            <p className="mt-1 text-title">{salary ?? t('facts.salaryNegotiable')}</p>
            {detail.deadline && (
              <p className="mt-3 text-sm text-muted-foreground">
                {t('facts.deadline')} · {formatKLDate(detail.deadline, locale)}
              </p>
            )}
            {applySection && <div className="mt-6">{applySection}</div>}
            <div className="mt-2 flex flex-wrap items-start gap-x-3 border-t pt-2">
              <ShareJobButton jobId={id} label={t('shareJobLabel')} copiedLabel={t('shareJobCopied')} />
              <ReportJobDialog jobId={id} />
            </div>
          </Card>
        </aside>

        <div className={cn('lg:col-start-1', modal ? 'mt-8' : 'mt-10')}>
          <dl
            aria-label={t('facts.label')}
            className="grid grid-cols-2 gap-x-8 border-y sm:grid-cols-3"
          >
            <Fact label={t('facts.type')}>{t(`type.${detail.type}`)}</Fact>
            <Fact label={t('facts.workMode')}>{t(`workMode.${detail.workMode}`)}</Fact>
            {location && <Fact label={t('facts.location')}>{location}</Fact>}
            {detail.headcount != null && (
              <Fact label={t('facts.headcount')}>
                {t('facts.headcountValue', { count: detail.headcount })}
              </Fact>
            )}
            {detail.languages.length > 0 && (
              <Fact label={t('facts.languages')}>{detail.languages.join(' · ')}</Fact>
            )}
          </dl>

          {detail.skills.length > 0 && (
            <ul aria-label={t('facts.skills')} className="mt-6 flex flex-wrap gap-2">
              {detail.skills.map((s) => (
                <li key={s}>
                  <Badge>{s}</Badge>
                </li>
              ))}
            </ul>
          )}

          <section className={modal ? 'mt-8' : 'mt-12'}>
            <h2 className="text-title">{t('descriptionLabel')}</h2>
            <p className="mt-4 whitespace-pre-wrap text-body">{detail.description}</p>
          </section>

          {detail.requirements && (
            <section className={modal ? 'mt-8' : 'mt-12'}>
              <h2 className="text-title">{t('requirementsLabel')}</h2>
              <p className="mt-4 whitespace-pre-wrap text-body">{detail.requirements}</p>
            </section>
          )}

          {detail.benefits && (
            <section className={modal ? 'mt-8' : 'mt-12'}>
              <h2 className="text-title">{t('benefitsLabel')}</h2>
              <p className="mt-4 whitespace-pre-wrap text-body">{detail.benefits}</p>
            </section>
          )}
        </div>
      </article>
    </div>
  )
}

function BackToJobs({ label, href }: { label: string; href: string }) {
  return (
    <Link
      href={href}
      prefetch={false}
      className="-ml-1 inline-flex min-h-8 items-center gap-0.5 rounded-full pr-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
    >
      <ChevronLeft aria-hidden="true" className="size-4" />
      {label}
    </Link>
  )
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="py-4">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-1 text-body font-medium">{children}</dd>
    </div>
  )
}

function LockedJobCard({
  title,
  companyName,
  state,
  locale,
  t,
  jobId,
  listHref,
  presentation,
}: {
  title: string
  companyName: string
  state: string | null
  locale: string
  t: Awaited<ReturnType<typeof getTranslations<'publicJobs'>>>
  jobId: string
  listHref: string
  presentation: 'page' | 'modal'
}) {
  return (
    <div className={presentation === 'modal' ? 'min-w-0' : 'page-shell max-w-3xl pb-20 pt-8 md:pt-12'}>
      {presentation !== 'modal' && <BackToJobs label={t('backToList')} href={listHref} />}
      <header className={presentation === 'modal' ? undefined : 'mt-6'}>
        <p className="text-body text-muted-foreground">
          {companyName}
          {state && <span> · {stateLabel(state, locale)}</span>}
        </p>
        <h1 className="mt-2 text-headline text-balance">{title}</h1>
      </header>
      <Card size="tile" className="mt-10 flex flex-col items-center text-center">
        <LockKeyhole aria-hidden="true" className="size-7 text-muted-foreground" strokeWidth={1.75} />
        <p className="mt-4 text-title">{t('lockedTitle')}</p>
        <p className="mt-2 max-w-md text-sm text-muted-foreground text-pretty">{t('lockedDesc')}</p>
        <Button asChild variant="brand" size="lg" className="mt-6">
          <Link href="/s/invite">{t('inviteButton')}</Link>
        </Button>
      </Card>
      <div className="flex flex-wrap items-start gap-x-3">
        <ShareJobButton jobId={jobId} label={t('shareJobLabel')} copiedLabel={t('shareJobCopied')} />
        <ReportJobDialog jobId={jobId} />
      </div>
    </div>
  )
}
