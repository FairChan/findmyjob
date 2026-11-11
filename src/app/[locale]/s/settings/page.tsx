import { getTranslations } from 'next-intl/server'
import { headers } from 'next/headers'
import { getSession } from '@/server/auth'
import { db } from '@/server/db'
import { redirect } from 'next/navigation'
import ChangePasswordForm from '@/components/auth/ChangePasswordForm'
import LocaleForm from '@/components/auth/LocaleForm'
import SignOutButton from '@/components/auth/SignOutButton'
import { WorkspacePage } from '@/components/layout/workspace-page'
import { Card } from '@/components/ui/card'

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
    <WorkspacePage title={t('title')}>
      <section aria-labelledby="settings-password">
        <Card className="space-y-5">
          <h2 id="settings-password" className="text-title">
            {t('changePasswordTitle')}
          </h2>
          <ChangePasswordForm />
        </Card>
      </section>

      <section aria-labelledby="settings-language">
        <Card className="space-y-5">
          <h2 id="settings-language" className="text-title">
            {t('languageTitle')}
          </h2>
          <LocaleForm currentLocale={userLocale} />
        </Card>
      </section>

      <section aria-labelledby="settings-sign-out">
        <Card className="space-y-5">
          <h2 id="settings-sign-out" className="text-title">
            {t('signOutTitle')}
          </h2>
          <SignOutButton />
        </Card>
      </section>
    </WorkspacePage>
  )
}
