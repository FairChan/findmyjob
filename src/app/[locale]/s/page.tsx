import { headers } from 'next/headers'
import Link from 'next/link'
import { getTranslations } from 'next-intl/server'
import { requireStudent } from '@/server/authz'
import { getDashboardData } from '@/server/services/student-profile'

export default async function StudentDashboardPage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  const t = await getTranslations('studentDashboard')
  const ctx = await requireStudent(await headers())
  const data = await getDashboardData(ctx)

  const todos: { key: string; href: string; show: boolean }[] = data
    ? [
        {
          key: 'VerifySchool',
          href: `/${locale}/s/school-verify`,
          show: data.schoolVerifiedAt === null,
        },
        {
          key: 'UploadResume',
          href: `/${locale}/s/profile`,
          show: !data.hasResume,
        },
        {
          key: 'FillContact',
          href: `/${locale}/s/contact`,
          show: !data.hasContact,
        },
        {
          key: 'EnableTalentPool',
          href: `/${locale}/s/privacy`,
          show: !data.talentPoolEnabled,
        },
      ]
    : []

  const pendingTodos = todos.filter((t) => t.show)

  return (
    <div className="container mx-auto max-w-4xl px-4 py-8 space-y-8">
      <h1 className="text-2xl font-bold">{t('title')}</h1>

      {data && (
        <section aria-label={t('completeness')} className="space-y-2">
          <div className="flex items-center justify-between text-sm font-medium">
            <span>{t('completeness')}</span>
            <span>{t('completenessValue', { value: data.completeness })}</span>
          </div>
          <div
            role="progressbar"
            aria-valuenow={data.completeness}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={t('completeness')}
            className="h-2 w-full rounded-full bg-muted overflow-hidden"
          >
            <div
              className="h-full bg-primary rounded-full transition-all"
              style={{ width: `${data.completeness}%` }}
            />
          </div>
        </section>
      )}

      {pendingTodos.length > 0 && (
        <section aria-label={t('todoTitle')}>
          <h2 className="text-lg font-semibold mb-3">{t('todoTitle')}</h2>
          <ul className="space-y-3">
            {pendingTodos.map((todo) => (
              <li
                key={todo.key}
                className="flex items-center justify-between rounded-lg border p-4 gap-4"
              >
                <div className="min-w-0">
                  <p className="font-medium text-sm">
                    {t(`todo${todo.key}` as Parameters<typeof t>[0])}
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {t(`todo${todo.key}Desc` as Parameters<typeof t>[0])}
                  </p>
                </div>
                <Link
                  href={todo.href}
                  className="shrink-0 text-xs font-medium text-primary underline-offset-2 hover:underline"
                >
                  {t('todoAction')}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <section aria-label={t('invitesTitle')}>
          <h2 className="text-lg font-semibold mb-3">{t('invitesTitle')}</h2>
          <div className="rounded-lg border p-6 text-sm text-muted-foreground text-center">
            {t('emptyPlaceholder')}
          </div>
        </section>

        <section aria-label={t('applicationsTitle')}>
          <h2 className="text-lg font-semibold mb-3">{t('applicationsTitle')}</h2>
          <div className="rounded-lg border p-6 text-sm text-muted-foreground text-center">
            {t('emptyPlaceholder')}
          </div>
        </section>
      </div>
    </div>
  )
}
