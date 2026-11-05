import { getTranslations } from 'next-intl/server'
import { Link } from '@/i18n/navigation'
import { env } from '@/env'
import EmployerRegisterForm from '@/components/auth/EmployerRegisterForm'

interface Props {
  params: Promise<{ locale: string }>
}

export default async function EmployerRegisterPage({ params: _ }: Props) {
  const t = await getTranslations('register')

  return (
    <div className="container mx-auto max-w-md px-4 py-12">
      <div className="rounded-lg border bg-card p-8 shadow-sm">
        <h1 className="text-2xl font-bold mb-6">{t('employerTitle')}</h1>
        <EmployerRegisterForm siteKey={env.TURNSTILE_SITE_KEY} />
        <div className="mt-4 flex items-center justify-between text-sm">
          <span className="text-muted-foreground">
            {t('loginHint')}{' '}
            <Link href="/login" className="text-brand underline-offset-4 hover:underline">
              {t('loginLink')}
            </Link>
          </span>
          <Link
            href="/register/student"
            className="text-muted-foreground underline-offset-4 hover:underline"
          >
            {t('switchToStudent')}
          </Link>
        </div>
      </div>
    </div>
  )
}
