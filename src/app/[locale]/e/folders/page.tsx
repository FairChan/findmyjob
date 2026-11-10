import 'server-only'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import Link from 'next/link'
import { requireCompanyMember } from '@/server/authz'
import { ForbiddenError } from '@/server/errors'
import { db } from '@/server/db'
import { listFolders } from '@/server/services/talent-folders'
import { FolderManager } from '@/components/talent/FolderManager'
import { Button } from '@/components/ui/button'

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
      <div className="container mx-auto max-w-2xl px-4 py-12">
        <div
          role="alert"
          className="rounded-lg border border-amber-200 bg-amber-50 p-8 text-center"
        >
          <h1 className="text-xl font-semibold text-amber-900">{t('verifyRequired')}</h1>
          <p className="mt-2 text-sm text-amber-700">{t('verifyDesc')}</p>
          <Button asChild className="mt-6">
            <Link href={`/${locale}/e/onboarding`}>{t('verifyAction')}</Link>
          </Button>
        </div>
      </div>
    )
  }

  const folders = await listFolders({ userId: ctx.userId, companyId: ctx.companyId })

  return (
    <div className="container mx-auto max-w-3xl px-4 py-6">
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
    </div>
  )
}
