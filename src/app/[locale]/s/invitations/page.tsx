import { headers } from 'next/headers'
import { getTranslations } from 'next-intl/server'
import { requireStudent } from '@/server/authz'
import { listStudentInvitations } from '@/server/services/invitations'
import { InvitationList } from '@/components/invitations/InvitationList'

export default async function StudentInvitationsPage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  const t = await getTranslations('invitations')
  const { userId } = await requireStudent(await headers())

  const invitations = await listStudentInvitations({ userId })

  return (
    <main id="main-content" className="container mx-auto max-w-2xl px-4 py-8">
      <h1 className="mb-1 text-2xl font-bold">{t('myInvitationsTitle')}</h1>
      <p className="mb-6 text-sm text-muted-foreground">{t('myInvitationsSubtitle')}</p>
      <InvitationList invitations={invitations} locale={locale} />
    </main>
  )
}
