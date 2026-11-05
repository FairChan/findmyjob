import { getTranslations } from 'next-intl/server'
import { headers } from 'next/headers'
import { getSession } from '@/server/auth'
import { db } from '@/server/db'
import { redirect } from 'next/navigation'
import ChangePasswordForm from '@/components/auth/ChangePasswordForm'
import LocaleForm from '@/components/auth/LocaleForm'

export default async function StudentSettingsPage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  const t = await getTranslations('settings')

  const h = await headers()
  const session = await getSession(h)
  if (!session?.user?.id) redirect(`/${locale}/login`)

  const user = await db.user.findUnique({
    where: { id: session.user.id },
    select: { locale: true },
  })

  const userLocale = (user?.locale as 'zh' | 'en') ?? 'zh'

  return (
    <div className="container mx-auto max-w-2xl px-4 py-12 space-y-10">
      <h1 className="text-2xl font-bold">{t('title')}</h1>

      <section className="rounded-lg border bg-card p-6 space-y-4">
        <h2 className="text-lg font-semibold">{t('changePasswordTitle')}</h2>
        <ChangePasswordForm />
      </section>

      <section className="rounded-lg border bg-card p-6 space-y-4">
        <h2 className="text-lg font-semibold">{t('languageTitle')}</h2>
        <LocaleForm currentLocale={userLocale} />
      </section>
    </div>
  )
}
