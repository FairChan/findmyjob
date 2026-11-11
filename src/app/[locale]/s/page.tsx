import { headers } from 'next/headers'
import Link from 'next/link'
import { ChevronRight } from 'lucide-react'
import { getTranslations } from 'next-intl/server'
import { requireStudent } from '@/server/authz'
import { getDashboardData } from '@/server/services/student-profile'
import { getStudentMatchingUiState } from '@/server/services/semantic-matching'
import { StudentMatchingPanel } from '@/components/matching/StudentMatchingPanel'
import { WorkspacePage } from '@/components/layout/workspace-page'
import { Card } from '@/components/ui/card'
import { Row, RowList } from '@/components/ui/row-list'

const ACTION_LINK =
  'inline-flex min-h-6 shrink-0 items-center gap-0.5 text-sm font-medium text-brand underline-offset-4 hover:underline'

export default async function StudentDashboardPage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  const t = await getTranslations('studentDashboard')
  const tNav = await getTranslations('nav')
  const tInv = await getTranslations('invitations')
  const ctx = await requireStudent(await headers())
  const data = await getDashboardData(ctx)
  const matchingState = await getStudentMatchingUiState({ userId: ctx.userId })

  const todos: { key: string; href: string; show: boolean }[] = data
    ? [
        {
          key: 'VerifySchool',
          href: `/${locale}/s/school-verify`,
          show: data.schoolVerifiedAt === null,
        },
        {
          key: 'UploadResume',
          href: `/${locale}/s/resume`,
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

  const shortcuts = [
    {
      href: `/${locale}/s/invitations`,
      title: tInv('navInvitations'),
      description: t('invitesDesc'),
      action: t('invitesLink'),
    },
    {
      href: `/${locale}/s/applications`,
      title: tNav('myApplications'),
      description: t('applicationsDesc'),
      action: t('applicationsLink'),
    },
  ]

  return (
    <WorkspacePage title={t('title')} width="wide">
      {data && (
        <section aria-label={t('completeness')}>
          <Card size="tile" className="flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-muted-foreground">{t('completeness')}</p>
              <p className="mt-2 text-headline tabular-nums">
                {t('completenessValue', { value: data.completeness })}
              </p>
              <div
                role="progressbar"
                aria-valuenow={data.completeness}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label={t('completeness')}
                className="mt-5 h-2 w-full overflow-hidden rounded-full bg-foreground/10"
              >
                <div
                  className="h-full rounded-full bg-foreground transition-[width] motion-reduce:transition-none"
                  style={{ width: `${data.completeness}%` }}
                />
              </div>
            </div>
            <Link href={`/${locale}/s/profile`} prefetch={false} className={ACTION_LINK}>
              {t('editProfile')}
              <ChevronRight aria-hidden="true" className="size-4" />
            </Link>
          </Card>
        </section>
      )}

      {pendingTodos.length > 0 && (
        <section aria-labelledby="dashboard-todo" className="space-y-4">
          <h2 id="dashboard-todo" className="text-title">
            {t('todoTitle')}
          </h2>
          <RowList>
            {pendingTodos.map((todo) => (
              <Row key={todo.key}>
                <div className="min-w-0">
                  <p id={`dashboard-todo-${todo.key}`} className="text-sm font-medium">
                    {t(`todo${todo.key}` as Parameters<typeof t>[0])}
                  </p>
                  <p className="mt-0.5 text-sm text-muted-foreground">
                    {t(`todo${todo.key}Desc` as Parameters<typeof t>[0])}
                  </p>
                </div>
                <Link
                  href={todo.href}
                  prefetch={false}
                  // Every row's link reads the same; the row title says which task it opens.
                  aria-describedby={`dashboard-todo-${todo.key}`}
                  className={ACTION_LINK}
                >
                  {t('todoAction')}
                  <ChevronRight aria-hidden="true" className="size-4" />
                </Link>
              </Row>
            ))}
          </RowList>
        </section>
      )}

      <StudentMatchingPanel locale={locale} uiState={matchingState} />

      <div className="grid gap-4 md:grid-cols-2">
        {shortcuts.map((shortcut) => (
          <Link key={shortcut.href} href={shortcut.href} prefetch={false} className="group block rounded-card">
            <Card className="h-full transition-[background-color,box-shadow] group-hover:bg-card group-hover:shadow-float motion-reduce:transition-none">
              <h2 className="text-body font-semibold">{shortcut.title}</h2>
              <p className="mt-1.5 text-sm text-muted-foreground">{shortcut.description}</p>
              <p className="mt-4 inline-flex items-center gap-0.5 text-sm font-medium text-brand">
                {shortcut.action}
                <ChevronRight aria-hidden="true" className="size-4" />
              </p>
            </Card>
          </Link>
        ))}
      </div>
    </WorkspacePage>
  )
}
