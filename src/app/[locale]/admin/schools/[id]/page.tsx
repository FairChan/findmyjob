import { notFound } from 'next/navigation'
import Link from 'next/link'
import { headers } from 'next/headers'
import { getTranslations } from 'next-intl/server'
import { requireAdmin } from '@/server/authz'
import { getSchool } from '@/server/services/admin-schools-partners'
import { SchoolForm } from './school-form'

export default async function AdminSchoolDetailPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>
}) {
  const { locale, id } = await params
  const ctx = await requireAdmin(await headers())
  const t = await getTranslations('adminSchools')

  const isNew = id === 'new'
  const school = isNew ? null : await getSchool(ctx, id).catch(() => null)

  if (!isNew && !school) return notFound()

  return (
    <main id="main-content" className="p-6 max-w-2xl mx-auto">
      <div className="mb-6">
        <Link
          href={`/${locale}/admin/schools`}
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          ← {t('backToList')}
        </Link>
      </div>
      <h1 className="text-2xl font-bold mb-6">
        {isNew ? t('newTitle') : t('editTitle')}
      </h1>
      <SchoolForm locale={locale} school={school} />
    </main>
  )
}
