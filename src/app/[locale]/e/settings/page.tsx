import { headers } from 'next/headers'
import { getTranslations } from 'next-intl/server'
import { requireEmployer } from '@/server/authz'
import { db } from '@/server/db'
import { notFound } from 'next/navigation'
import { WorkspacePage } from '@/components/layout/workspace-page'
import { Card } from '@/components/ui/card'
import AccountNameForm from '@/components/auth/AccountNameForm'
import ChangePasswordForm from '@/components/auth/ChangePasswordForm'
import LocaleForm from '@/components/auth/LocaleForm'

export default async function EmployerSettingsPage() {
  const { userId } = await requireEmployer(await headers())
  const user = await db.user.findUnique({ where: { id: userId }, select: { name: true, email: true, locale: true } })
  if (!user) notFound()
  const t = await getTranslations('memberNav')
  const settings = await getTranslations('settings')
  return <WorkspacePage title={t('account')}>
    <Card><AccountNameForm name={user.name} email={user.email} /></Card>
    <Card className="space-y-5"><h2 className="text-title">{settings('changePasswordTitle')}</h2><ChangePasswordForm /></Card>
    <Card className="space-y-5"><h2 className="text-title">{settings('languageTitle')}</h2><LocaleForm currentLocale={user.locale === 'en' ? 'en' : 'zh'} /></Card>
  </WorkspacePage>
}
