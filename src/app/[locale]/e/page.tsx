import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { ChevronRight } from 'lucide-react'
import { Link } from '@/i18n/navigation'
import { WorkspacePage } from '@/components/layout/workspace-page'
import { Card } from '@/components/ui/card'
import { requireCompanyMember } from '@/server/authz'
import { ForbiddenError } from '@/server/errors'
import { getSession } from '@/server/auth'
import { db } from '@/server/db'
import { getWalletBalance } from '@/server/services/credits'
import { getVerificationInfo } from '@/server/services/verification'
import type { VerificationStatus } from '@prisma/client'

interface BannerConfig {
  bg: string
  textColor: string
  title: string
  desc: string
  cta: { label: string; href: string } | null
}

export default async function EmployerDashboardPage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  const h = await headers()
  const t = await getTranslations('employerDashboard')

  let ctx: Awaited<ReturnType<typeof requireCompanyMember>>
  try {
    ctx = await requireCompanyMember('RECRUITER', h)
  } catch (err) {
    if (err instanceof ForbiddenError) {
      // If the user has no company membership at all, send them to onboarding.
      // Any other ForbiddenError (inactive company, role check) must propagate.
      const session = await getSession(h)
      if (session?.user?.id) {
        const member = await db.companyMember.findFirst({
          where: { userId: session.user.id },
          select: { id: true },
        })
        if (!member) redirect(`/${locale}/e/onboarding`)
      }
    }
    throw err
  }

  const { companyId, role } = ctx
  const isAdminOrOwner = role === 'OWNER' || role === 'ADMIN'

  const company = await db.company.findUnique({
    where: { id: companyId },
    select: { verificationStatus: true },
  })
  if (!company) throw new ForbiddenError()

  const balance =
    company.verificationStatus === 'VERIFIED'
      ? await getWalletBalance(ctx)
      : null

  // All members see the rejection reason in the REJECTED banner (M3-T02 acceptance criterion)
  let rejectionNote: string | null = null
  if (company.verificationStatus === 'REJECTED') {
    const info = await getVerificationInfo(ctx)
    rejectionNote = info.latest?.reviewNote ?? null
  }

  const bannerMap: Record<VerificationStatus, BannerConfig> = {
    UNSUBMITTED: {
      bg: 'bg-brand-muted',
      textColor: 'text-brand-muted-foreground',
      title: t('bannerUnsubmittedTitle'),
      desc: t('bannerUnsubmittedDesc'),
      cta: isAdminOrOwner
        ? { label: t('bannerUnsubmittedCta'), href: '/e/verification' }
        : null,
    },
    PENDING: {
      bg: 'bg-warning-muted',
      textColor: 'text-warning',
      title: t('bannerPendingTitle'),
      desc: t('bannerPendingDesc'),
      cta: null,
    },
    REJECTED: {
      bg: 'bg-destructive-muted',
      textColor: 'text-destructive',
      title: t('bannerRejectedTitle'),
      desc: t('bannerRejectedDesc'),
      cta: isAdminOrOwner
        ? { label: t('bannerRejectedCta'), href: '/e/verification' }
        : null,
    },
    VERIFIED: {
      bg: 'bg-success-muted',
      textColor: 'text-success',
      title: t('bannerVerifiedTitle'),
      desc: t('bannerVerifiedDesc'),
      cta: null,
    },
  }

  const banner = bannerMap[company.verificationStatus]

  // /e/company and /e/verification require ADMIN; /e/team is accessible to RECRUITER
  const quickLinks = [
    ...(isAdminOrOwner
      ? [
          { href: '/e/company' as const, label: t('linkCompany') },
          { href: '/e/verification' as const, label: t('linkVerification') },
        ]
      : []),
    { href: '/e/team' as const, label: t('linkTeam') },
    ...(role === 'OWNER' ? [{ href: '/e/billing' as const, label: t('linkBilling') }] : []),
  ]

  const showAdminNote =
    !isAdminOrOwner &&
    (company.verificationStatus === 'UNSUBMITTED' || company.verificationStatus === 'REJECTED')

  return (
    <WorkspacePage title={t('title')} width="wide">
      {/* Verification status banner */}
      <div className={`rounded-card p-5 sm:p-6 ${banner.bg}`}>
        <p className={`font-semibold ${banner.textColor}`}>{banner.title}</p>
        <p className={`mt-1 text-sm ${banner.textColor}`}>{banner.desc}</p>
        {company.verificationStatus === 'REJECTED' && rejectionNote && (
          <p className={`mt-2 text-sm ${banner.textColor}`}>
            <span className="font-medium">{t('bannerRejectedReason')}：</span>
            {rejectionNote}
          </p>
        )}
        {banner.cta && (
          <Link
            href={banner.cta.href}
            className={`mt-3 inline-flex min-h-6 items-center text-sm font-medium underline underline-offset-4 ${banner.textColor}`}
          >
            {banner.cta.label}
          </Link>
        )}
        {showAdminNote && (
          <p className={`mt-3 text-sm ${banner.textColor}`}>{t('bannerAdminActionRequired')}</p>
        )}
      </div>

      {/* Credits balance — only shown for verified companies */}
      {company.verificationStatus === 'VERIFIED' && (
        <Card size="tile">
          <p className="text-sm font-medium text-muted-foreground">{t('creditsBalance')}</p>
          <p className="mt-2 text-headline tabular-nums">
            {balance ?? 0}
            <span className="ml-2 text-body font-normal text-muted-foreground">
              {t('creditsUnit')}
            </span>
          </p>
        </Card>
      )}

      {/* Quick links */}
      <section aria-labelledby="employer-quick-links" className="space-y-4">
        <h2 id="employer-quick-links" className="text-title">
          {t('quickLinks')}
        </h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {quickLinks.map(link => (
            <Link
              key={link.href}
              href={link.href}
              className="group flex min-h-16 items-center justify-between gap-2 rounded-card bg-muted px-5 py-4 text-sm font-medium transition-[background-color,box-shadow] hover:bg-card hover:shadow-float motion-reduce:transition-none"
            >
              {link.label}
              <ChevronRight aria-hidden="true" className="size-4 text-muted-foreground" />
            </Link>
          ))}
        </div>
      </section>
    </WorkspacePage>
  )
}
