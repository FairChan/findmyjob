import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { Link } from '@/i18n/navigation'
import { requireEmployer } from '@/server/authz'
import { getMyCompany } from '@/server/services/company'
import { getWalletBalance } from '@/server/services/credits'
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
  const t = await getTranslations('employerDashboard')

  const { userId } = await requireEmployer(await headers())
  const company = await getMyCompany({ userId })

  if (!company) {
    redirect(`/${locale}/e/onboarding`)
  }

  const balance =
    company.verificationStatus === 'VERIFIED'
      ? await getWalletBalance(company.id)
      : null

  const bannerMap: Record<VerificationStatus, BannerConfig> = {
    UNSUBMITTED: {
      bg: 'bg-blue-50 border-blue-200',
      textColor: 'text-blue-800',
      title: t('bannerUnsubmittedTitle'),
      desc: t('bannerUnsubmittedDesc'),
      cta: { label: t('bannerUnsubmittedCta'), href: '/e/verification' },
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
      cta: { label: t('bannerRejectedCta'), href: '/e/verification' },
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

  const quickLinks = [
    { href: '/e/company' as const, label: t('linkCompany') },
    { href: '/e/verification' as const, label: t('linkVerification') },
    { href: '/e/team' as const, label: t('linkTeam') },
  ]

  return (
    <main className="container mx-auto max-w-4xl px-4 py-12">
      <h1 className="mb-8 text-2xl font-bold">{t('title')}</h1>

      {/* Verification status banner */}
      <div className={`mb-8 rounded-lg border p-4 ${banner.bg}`}>
        <p className={`font-medium ${banner.textColor}`}>{banner.title}</p>
        <p className={`mt-1 text-sm ${banner.textColor}`}>{banner.desc}</p>
        {banner.cta && (
          <Link
            href={banner.cta.href}
            className={`mt-3 inline-block text-sm font-medium underline ${banner.textColor}`}
          >
            {banner.cta.label}
          </Link>
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
    </main>
  )
}
