import { headers } from 'next/headers'
import { getTranslations } from 'next-intl/server'
import { requireStudent } from '@/server/authz'
import { listStudentInvitations } from '@/server/services/invitations'
import { InvitationList } from '@/components/invitations/InvitationList'
import { WorkspacePage } from '@/components/layout/workspace-page'

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
    <WorkspacePage title={t('myInvitationsTitle')} lead={t('myInvitationsSubtitle')} width="list">
      <InvitationList invitations={invitations} locale={locale} />
    </WorkspacePage>
  )
}
