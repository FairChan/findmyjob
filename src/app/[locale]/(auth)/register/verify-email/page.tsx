import { getTranslations } from 'next-intl/server'
import { Link } from '@/i18n/navigation'

interface Props {
  searchParams: Promise<{ email?: string }>
}

export default async function VerifyEmailPage({ searchParams }: Props) {
  const { email = '' } = await searchParams
  const t = await getTranslations('verifyEmail')

  return (
    <div className="container mx-auto max-w-md px-4 py-12">
      <div className="rounded-lg border bg-card p-8 shadow-sm text-center">
        <h1 className="text-2xl font-bold mb-4">{t('title')}</h1>
        <p className="text-muted-foreground mb-6">
          {t('message', { email: email || '—' })}
        </p>
        <p className="text-sm text-muted-foreground">
          {t('hint')}{' '}
          <Link
            href="/register/student"
            className="text-brand underline-offset-4 hover:underline"
          >
            {t('backToRegister')}
          </Link>
        </p>
      </div>
    </div>
  )
}
