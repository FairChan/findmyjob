import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { requireCompanyMember } from '@/server/authz'
import { getMyCompany } from '@/server/services/company'
import { getVerificationInfo } from '@/server/services/verification'
import { VerificationForm } from '@/components/employer/verification-form'
import { Link } from '@/i18n/navigation'
import { WorkspacePage } from '@/components/layout/workspace-page'
import { Badge, type BadgeProps } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'

// The status card is muted, so the not-started state uses the plain chip.
const STATUS_TONE: Record<string, BadgeProps['tone']> = {
  UNSUBMITTED: 'plain',
  PENDING: 'warning',
  VERIFIED: 'success',
  REJECTED: 'danger',
}

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
    <WorkspacePage title={t('title')} lead={t('subtitle')}>
      {/* Current status */}
      <Card className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-muted-foreground">{t('statusLabel')}：</span>
        <Badge tone={STATUS_TONE[info.status] ?? 'plain'}>{statusKeyMap[info.status] ?? info.status}</Badge>
      </Card>

      {/* Rejection reason */}
      {info.status === 'REJECTED' && info.latest?.reviewNote && (
        <div className="rounded-card bg-destructive-muted p-5">
          <p className="text-sm font-medium text-destructive">{t('rejectionReason')}</p>
          <p className="mt-1 whitespace-pre-wrap text-sm text-destructive">{info.latest.reviewNote}</p>
        </div>
      )}

      {/* Status messages */}
      {info.status === 'PENDING' && (
        <div className="rounded-card bg-warning-muted p-5">
          <p className="text-sm text-warning">{t('pendingMessage')}</p>
        </div>
      )}

      {info.status === 'VERIFIED' && (
        <div className="rounded-card bg-success-muted p-5">
          <p className="text-sm text-success">{t('verifiedMessage')}</p>
        </div>
      )}

      {/* Re-submit hint */}
      {info.status === 'REJECTED' && (
        <p className="text-sm text-muted-foreground">{t('resubmitHint')}</p>
      )}

      {/* Submission form */}
      {canSubmit && <VerificationForm locale={locale} />}

      {/* Back link */}
      <Link
        href="/e/company"
        className="inline-flex min-h-6 items-center text-sm text-brand underline-offset-4 hover:underline"
      >
        {t('goToCompany')}
      </Link>
    </WorkspacePage>
  )
}
