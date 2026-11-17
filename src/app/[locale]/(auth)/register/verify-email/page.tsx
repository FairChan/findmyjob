import { getTranslations } from 'next-intl/server'
import { AuthCard } from '@/components/auth/auth-card'
import ResendVerificationForm from '@/components/auth/ResendVerificationForm'
import { Link } from '@/i18n/navigation'
import { env } from '@/env'

interface Props {
  searchParams: Promise<{ role?: string }>
}

export default async function VerifyEmailPage({ searchParams }: Props) {
  const t = await getTranslations('verifyEmail')
  const { role } = await searchParams
  const isEmployer = role === 'employer'

  return (
    <AuthCard title={t('title')} contentClassName="text-center">
      <p className="mb-2 text-muted-foreground">{t('message')}</p>
      <p className="mb-6 text-sm text-muted-foreground">{t('expiryHint')}</p>
      <div className="mb-6 rounded-control bg-muted/50 p-4">
        <p className="mb-3 text-sm text-muted-foreground">{t('hint')}</p>
        <ResendVerificationForm siteKey={env.TURNSTILE_SITE_KEY} />
      </div>
      <p className="text-sm text-muted-foreground">
        {t('alreadyVerified')}{' '}
        <Link href="/login" className="text-brand underline underline-offset-4">
          {t('goToLogin')}
        </Link>
        {' · '}
        <Link href={isEmployer ? '/register/employer' : '/register/student'} className="text-brand underline underline-offset-4">
          {t('backToRegister')}
        </Link>
      </p>
    </AuthCard>
  )
}
