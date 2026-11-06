import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { requireCompanyMember } from '@/server/authz'
import { getMyCompany } from '@/server/services/company'
import { getVerificationInfo } from '@/server/services/verification'
import { VerificationForm } from '@/components/employer/verification-form'
import { Link } from '@/i18n/navigation'

export default async function VerificationPage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  const t = await getTranslations('companyVerification')

  const ctx = await requireCompanyMember('ADMIN', await headers())
  const company = await getMyCompany({ userId: ctx.userId })

  if (!company) {
    redirect(`/${locale}/e/onboarding`)
  }

  const info = await getVerificationInfo({ userId: ctx.userId, companyId: ctx.companyId, role: ctx.role })

  const statusKeyMap: Record<string, string> = {
    UNSUBMITTED: t('statusUnsubmitted'),
    PENDING: t('statusPending'),
    VERIFIED: t('statusVerified'),
    REJECTED: t('statusRejected'),
  }

  const canSubmit = info.status === 'UNSUBMITTED' || info.status === 'REJECTED'

  return (
    <div className="container mx-auto max-w-2xl px-4 py-12">
      <h1 className="mb-2 text-2xl font-bold">{t('title')}</h1>
      <p className="mb-8 text-muted-foreground">{t('subtitle')}</p>

      {/* Current status */}
      <div className="mb-8 rounded-lg border p-4">
        <span className="text-sm text-muted-foreground">{t('statusLabel')}：</span>
        <span className="ml-1 font-medium">{statusKeyMap[info.status] ?? info.status}</span>
      </div>

      {/* Rejection reason */}
      {info.status === 'REJECTED' && info.latest?.reviewNote && (
        <div className="mb-6 rounded-lg border border-red-200 bg-red-50 p-4">
          <p className="text-sm font-medium text-red-800">{t('rejectionReason')}</p>
          <p className="mt-1 text-sm text-red-700">{info.latest.reviewNote}</p>
        </div>
      )}

      {/* Status messages */}
      {info.status === 'PENDING' && (
        <div className="mb-6 rounded-lg border border-yellow-200 bg-yellow-50 p-4">
          <p className="text-sm text-yellow-800">{t('pendingMessage')}</p>
        </div>
      )}

      {info.status === 'VERIFIED' && (
        <div className="mb-6 rounded-lg border border-green-200 bg-green-50 p-4">
          <p className="text-sm text-green-800">{t('verifiedMessage')}</p>
        </div>
      )}

      {/* Re-submit hint */}
      {info.status === 'REJECTED' && (
        <p className="mb-4 text-sm text-muted-foreground">{t('resubmitHint')}</p>
      )}

      {/* Submission form */}
      {canSubmit && <VerificationForm locale={locale} />}

      {/* Back link */}
      <div className="mt-8">
        <Link
          href="/e/company"
          className="text-sm text-brand hover:underline"
        >
          {t('goToCompany')}
        </Link>
      </div>
    </div>
  )
}
