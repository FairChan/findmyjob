import { getTranslations } from 'next-intl/server'
import { AuthCard } from '@/components/auth/auth-card'
import { Link } from '@/i18n/navigation'
import { env } from '@/env'
import ForgotPasswordForm from '@/components/auth/ForgotPasswordForm'

export default async function ForgotPasswordPage() {
  const t = await getTranslations('forgotPassword')

  return (
    <AuthCard title={t('title')}>
        <ForgotPasswordForm siteKey={env.TURNSTILE_SITE_KEY} />
        <div className="mt-4 text-center text-sm">
          <Link href="/login" className="text-brand underline underline-offset-4">
            {t('backToLogin')}
          </Link>
        </div>
    </AuthCard>
  )
}
