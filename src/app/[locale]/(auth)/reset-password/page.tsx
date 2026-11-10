import { getTranslations } from 'next-intl/server'
import { AuthCard } from '@/components/auth/auth-card'
import { Link } from '@/i18n/navigation'
import ResetPasswordForm from '@/components/auth/ResetPasswordForm'

interface Props {
  params: Promise<{ locale: string }>
  searchParams: Promise<{ token?: string }>
}

export default async function ResetPasswordPage({ params, searchParams }: Props) {
  const { locale } = await params
  const { token = '' } = await searchParams
  const t = await getTranslations('resetPassword')

  if (!token) {
    return (
      <div className="page-shell max-w-md py-10 md:py-16">
        <div className="auth-enter rounded-tile bg-card p-6 text-center shadow-float sm:p-8">
          <p className="text-sm text-destructive mb-4">{t('errorMissingToken')}</p>
          <Link href="/forgot-password" className="text-brand underline underline-offset-4 text-sm">
            {t('requestNewLink')}
          </Link>
        </div>
      </div>
    )
  }

  return (
    <AuthCard title={t('title')}>
        <ResetPasswordForm token={token} locale={locale} />
        <div className="mt-4 text-center text-sm">
          <Link href="/login" className="text-brand underline underline-offset-4">
            {t('backToLogin')}
          </Link>
        </div>
    </AuthCard>
  )
}
