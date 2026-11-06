import 'server-only'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { requireCompanyMember } from '@/server/authz'
import { ForbiddenError } from '@/server/errors'
import { listFolders } from '@/server/services/talent-folders'
import { FolderManager } from '@/components/talent/FolderManager'

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

  const folders = await listFolders({ userId: ctx.userId, companyId: ctx.companyId })

  return (
    <main id="main-content" className="container mx-auto max-w-3xl px-4 py-6">
      <h1 className="mb-6 text-2xl font-bold">{t('title')}</h1>

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
    </main>
  )
}
