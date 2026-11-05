import { getTranslations } from 'next-intl/server'
import { Link } from '@/i18n/navigation'
import StudentRegisterForm from '@/components/auth/StudentRegisterForm'

interface Props {
  params: Promise<{ locale: string }>
  searchParams: Promise<{ ref?: string }>
}

export default async function StudentRegisterPage({ params, searchParams }: Props) {
  const { locale } = await params
  const { ref } = await searchParams
  const t = await getTranslations('register')

  return (
    <div className="container mx-auto max-w-md px-4 py-12">
      <div className="rounded-lg border bg-card p-8 shadow-sm">
        <h1 className="text-2xl font-bold mb-6">{t('studentTitle')}</h1>
        <StudentRegisterForm locale={locale} ref={ref} />
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
