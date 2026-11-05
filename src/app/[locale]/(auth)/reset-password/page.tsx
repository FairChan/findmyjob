import { getTranslations } from 'next-intl/server'
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
      <div className="container mx-auto max-w-md px-4 py-12">
        <div className="rounded-lg border bg-card p-8 shadow-sm text-center">
          <p className="text-sm text-destructive mb-4">{t('errorMissingToken')}</p>
          <Link href="/forgot-password" className="text-brand underline-offset-4 hover:underline text-sm">
            {t('requestNewLink')}
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="container mx-auto max-w-md px-4 py-12">
      <div className="rounded-lg border bg-card p-8 shadow-sm">
        <h1 className="text-2xl font-bold mb-6">{t('title')}</h1>
        <ResetPasswordForm token={token} locale={locale} />
        <div className="mt-4 text-center text-sm">
          <Link href="/login" className="text-brand underline-offset-4 hover:underline">
            {t('backToLogin')}
          </Link>
        </div>
      </div>
    </div>
  )
}
