import { getTranslations } from 'next-intl/server'
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
    <div className="container mx-auto max-w-md px-4 py-12">
      <div className="rounded-lg border bg-card p-8 shadow-sm">
        <h1 className="text-2xl font-bold mb-6">{t('studentTitle')}</h1>
        {signupClosed ? (
          <div className="rounded-md border border-destructive/30 bg-destructive/10 p-4 text-center text-sm text-destructive">
            {t('signupClosed')}
          </div>
        ) : (
          <StudentRegisterForm locale={locale} ref={ref} siteKey={env.TURNSTILE_SITE_KEY} />
        )}
        <div className="mt-4 flex items-center justify-between text-sm">
          <span className="text-muted-foreground">
            {t('loginHint')}{' '}
            <Link href="/login" className="text-brand underline-offset-4 hover:underline">
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
      </div>
    </div>
  )
}
