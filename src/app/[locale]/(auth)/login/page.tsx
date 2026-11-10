import { getTranslations } from 'next-intl/server'
import { AuthCard } from '@/components/auth/auth-card'
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
    <AuthCard title={t('title')} social>
        <LoginForm locale={locale} redirect={redirect} siteKey={env.TURNSTILE_SITE_KEY} />
    </AuthCard>
  )
}
