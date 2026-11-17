import { getTranslations } from 'next-intl/server'
import { AuthCard } from '@/components/auth/auth-card'
import { env } from '@/env'
import LoginForm from '@/components/auth/LoginForm'
import ResendVerificationForm from '@/components/auth/ResendVerificationForm'
import { verificationOutcome } from '@/lib/email-verification'

interface Props {
  params: Promise<{ locale: string }>
  searchParams: Promise<{ redirect?: string; verified?: string; error?: string }>
}

export default async function LoginPage({ params, searchParams }: Props) {
  const { locale } = await params
  const { redirect, verified, error } = await searchParams
  const t = await getTranslations('login')
  const outcome = verificationOutcome({ verified, error })

  return (
    <AuthCard title={t('title')} social>
      {outcome === 'verified' && (
        <p role="status" className="mb-4 rounded-control bg-success-muted p-3 text-sm text-success">
          {t('emailVerified')}
        </p>
      )}
      {(outcome === 'expired' || outcome === 'invalid') && (
        <div role="alert" className="mb-4 space-y-3 rounded-control bg-destructive-muted p-3 text-sm text-destructive">
          <p>{t(outcome === 'expired' ? 'verifyLinkExpired' : 'verifyLinkInvalid')}</p>
          <ResendVerificationForm siteKey={env.TURNSTILE_SITE_KEY} compact />
        </div>
      )}
      <LoginForm locale={locale} redirect={redirect} siteKey={env.TURNSTILE_SITE_KEY} />
    </AuthCard>
  )
}
