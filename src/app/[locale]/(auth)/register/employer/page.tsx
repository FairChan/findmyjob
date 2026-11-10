import { getTranslations } from 'next-intl/server'
import { AuthCard } from '@/components/auth/auth-card'
import { Link } from '@/i18n/navigation'
import { env } from '@/env'
import EmployerRegisterForm from '@/components/auth/EmployerRegisterForm'

interface Props {
  params: Promise<{ locale: string }>
}

export default async function EmployerRegisterPage({ params: _ }: Props) {
  const t = await getTranslations('register')

  return (
    <AuthCard title={t('employerTitle')} social>
        <EmployerRegisterForm siteKey={env.TURNSTILE_SITE_KEY} />
        <div className="mt-4 flex items-center justify-between text-sm">
          <span className="text-muted-foreground">
            {t('loginHint')}{' '}
            <Link href="/login" className="text-brand underline underline-offset-4">
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
    </AuthCard>
  )
}
