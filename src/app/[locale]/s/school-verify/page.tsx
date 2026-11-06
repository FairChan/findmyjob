import { headers } from 'next/headers'
import { getTranslations } from 'next-intl/server'
import { requireStudent } from '@/server/authz'
import { db } from '@/server/db'
import { listActiveSchools } from '@/server/services/school-verification'
import SchoolVerifyForm from '@/components/school-verify/SchoolVerifyForm'

interface Props {
  params: Promise<{ locale: string }>
}

export default async function SchoolVerifyPage({ params }: Props) {
  const { locale } = await params
  const t = await getTranslations('schoolVerify')
  const { userId } = await requireStudent(await headers())

  const [schools, profile] = await Promise.all([
    listActiveSchools(),
    db.studentProfile.findUnique({
      where: { userId },
      select: { schoolEmail: true, schoolVerifiedAt: true },
    }),
  ])

  const initiallyVerified = profile?.schoolVerifiedAt != null

  return (
    <main id="main-content" className="container mx-auto max-w-2xl px-4 py-8">
      <h1 className="mb-2 text-2xl font-bold">{t('title')}</h1>
      <p className="mb-8 text-sm text-muted-foreground">{t('subtitle')}</p>
      <SchoolVerifyForm
        schools={schools}
        locale={locale}
        initiallyVerified={initiallyVerified}
        verifiedEmail={profile?.schoolEmail ?? null}
      />
    </main>
  )
}
