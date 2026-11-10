import { getTranslations } from 'next-intl/server'
import { AuthCard } from '@/components/auth/auth-card'
import { Link } from '@/i18n/navigation'
import { env } from '@/env'
import StudentRegisterForm from '@/components/auth/StudentRegisterForm'
import { assertStudentSignupOpen } from '@/server/services/signup-cap'
import { SignupClosedError } from '@/server/errors'

interface Props {
  params: Promise<{ locale: string }>
  searchParams: Promise<{ ref?: string }>
}

export default async function StudentRegisterPage({ params, searchParams }: Props) {
  const { locale } = await params
  const { ref } = await searchParams
  const t = await getTranslations('register')

  let signupClosed = false
  try {
    await assertStudentSignupOpen()
  } catch (err) {
    if (err instanceof SignupClosedError) {
      signupClosed = true
    } else {
      throw err
    }
  }

  return (
    <AuthCard title={t('studentTitle')} social>
        {signupClosed ? (
          <div className="rounded-control bg-destructive-muted p-4 text-center text-sm text-destructive">
            {t('signupClosed')}
          </div>
        ) : (
          <StudentRegisterForm locale={locale} ref={ref} siteKey={env.TURNSTILE_SITE_KEY} />
        )}
        <div className="mt-4 flex items-center justify-between text-sm">
          <span className="text-muted-foreground">
            {t('loginHint')}{' '}
            <Link href="/login" className="text-brand underline underline-offset-4">
              {t('loginLink')}
            </Link>
          </span>
          <Link
            href="/register/employer"
            className="text-muted-foreground underline-offset-4 hover:underline"
          >
            {t('switchToEmployer')}
          </Link>
        </div>
    </AuthCard>
  )
}
