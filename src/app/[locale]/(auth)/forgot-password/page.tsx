import { getTranslations } from 'next-intl/server'
import { Link } from '@/i18n/navigation'
import ForgotPasswordForm from '@/components/auth/ForgotPasswordForm'

export default async function ForgotPasswordPage() {
  const t = await getTranslations('forgotPassword')

  return (
    <div className="container mx-auto max-w-md px-4 py-12">
      <div className="rounded-lg border bg-card p-8 shadow-sm">
        <h1 className="text-2xl font-bold mb-6">{t('title')}</h1>
        <ForgotPasswordForm />
        <div className="mt-4 text-center text-sm">
          <Link href="/login" className="text-brand underline-offset-4 hover:underline">
            {t('backToLogin')}
          </Link>
        </div>
      </div>
    </div>
  )
}
