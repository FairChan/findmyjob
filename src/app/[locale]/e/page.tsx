import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { Link } from '@/i18n/navigation'
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
      bg: 'bg-blue-50 border-blue-200',
      textColor: 'text-blue-800',
      title: t('bannerUnsubmittedTitle'),
      desc: t('bannerUnsubmittedDesc'),
      cta: isAdminOrOwner
        ? { label: t('bannerUnsubmittedCta'), href: '/e/verification' }
        : null,
    },
    PENDING: {
      bg: 'bg-yellow-50 border-yellow-200',
      textColor: 'text-yellow-800',
      title: t('bannerPendingTitle'),
      desc: t('bannerPendingDesc'),
      cta: null,
    },
    REJECTED: {
      bg: 'bg-red-50 border-red-200',
      textColor: 'text-red-800',
      title: t('bannerRejectedTitle'),
      desc: t('bannerRejectedDesc'),
      cta: isAdminOrOwner
        ? { label: t('bannerRejectedCta'), href: '/e/verification' }
        : null,
    },
    VERIFIED: {
      bg: 'bg-green-50 border-green-200',
      textColor: 'text-green-800',
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
    <div className="container mx-auto max-w-4xl px-4 py-12">
      <h1 className="mb-8 text-2xl font-bold">{t('title')}</h1>

      {/* Verification status banner */}
      <div className={`mb-8 rounded-lg border p-4 ${banner.bg}`}>
        <p className={`font-medium ${banner.textColor}`}>{banner.title}</p>
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
            className={`mt-3 inline-block text-sm font-medium underline ${banner.textColor}`}
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
        <div className="mb-8 rounded-lg border p-4">
          <p className="text-sm text-muted-foreground">{t('creditsBalance')}</p>
          <p className="mt-1 text-2xl font-bold">
            {balance ?? 0}
            <span className="ml-1 text-sm font-normal text-muted-foreground">
              {t('creditsUnit')}
            </span>
          </p>
        </div>
      )}

      {/* Quick links */}
      <div>
        <h2 className="mb-4 text-lg font-semibold">{t('quickLinks')}</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {quickLinks.map(link => (
            <Link
              key={link.href}
              href={link.href}
              className="rounded-lg border p-4 text-sm font-medium transition-colors hover:bg-muted/50"
            >
              {link.label}
            </Link>
          ))}
        </div>
      </div>
    </div>
  )
}
