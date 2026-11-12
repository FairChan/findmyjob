import 'server-only'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { requireCompanyMember } from '@/server/authz'
import { ForbiddenError } from '@/server/errors'
import { db } from '@/server/db'
import { listFolders } from '@/server/services/talent-folders'
import { FolderManager } from '@/components/talent/FolderManager'
import { WorkspaceNotice } from '@/components/layout/workspace-notice'
import { WorkspacePage } from '@/components/layout/workspace-page'

export default async function FoldersPage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  const t = await getTranslations('talentFolders')

  let ctx: { userId: string; companyId: string }
  try {
    ctx = await requireCompanyMember('RECRUITER', await headers())
  } catch (err) {
    if (err instanceof ForbiddenError) redirect(`/${locale}/e/onboarding`)
    throw err
  }

  const company = await db.company.findUnique({
    where: { id: ctx.companyId },
    select: { verificationStatus: true },
  })

  if (company?.verificationStatus !== 'VERIFIED') {
    return (
      <WorkspaceNotice
        title={t('verifyRequired')}
        description={t('verifyDesc')}
        action={{ label: t('verifyAction'), href: `/${locale}/e/onboarding` }}
      />
    )
  }

  const folders = await listFolders({ userId: ctx.userId, companyId: ctx.companyId })

  return (
    <WorkspacePage title={t('title')} width="list">
      <FolderManager
        initialFolders={folders}
        locale={locale}
        labels={{
          createFolder: t('createFolder'),
          folderNamePlaceholder: t('folderNamePlaceholder'),
          create: t('create'),
          rename: t('rename'),
          delete: t('delete'),
          cancel: t('cancel'),
          confirm: t('confirm'),
          deleteConfirm: t('deleteConfirm'),
          items: t('items'),
          noFolders: t('noFolders'),
          viewFolder: t('viewFolder'),
        }}
      />
    </WorkspacePage>
  )
}
