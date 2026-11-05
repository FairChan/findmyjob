import { getTranslations } from 'next-intl/server'
import { env } from '@/env'
import LoginForm from '@/components/auth/LoginForm'

interface Props {
  params: Promise<{ locale: string }>
  searchParams: Promise<{ redirect?: string }>
}

export default async function LoginPage({ params, searchParams }: Props) {
  const { locale } = await params
  const { redirect } = await searchParams
  const t = await getTranslations('login')

  return (
    <div className="container mx-auto max-w-md px-4 py-12">
      <div className="rounded-lg border bg-card p-8 shadow-sm">
        <h1 className="text-2xl font-bold mb-6">{t('title')}</h1>
        <LoginForm locale={locale} redirect={redirect} siteKey={env.TURNSTILE_SITE_KEY} />
      </div>
    </div>
  )
}
