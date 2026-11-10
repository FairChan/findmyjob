import { getTranslations } from 'next-intl/server'
import { AuthCard } from '@/components/auth/auth-card'
import { Link } from '@/i18n/navigation'

export default async function VerifyEmailPage() {
  const t = await getTranslations('verifyEmail')

  return (
    <AuthCard title={t('title')} contentClassName="text-center">
        <p className="text-muted-foreground mb-6">
          {t('message')}
        </p>
        <p className="text-sm text-muted-foreground">
          {t('hint')}{' '}
          <Link
            href="/register/student"
            className="text-brand underline underline-offset-4"
          >
            {t('backToRegister')}
          </Link>
        </p>
    </AuthCard>
  )
}
