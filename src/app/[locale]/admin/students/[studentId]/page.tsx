import Link from 'next/link'
import { headers } from 'next/headers'
import { getTranslations } from 'next-intl/server'
import { requireAdmin } from '@/server/authz'
import { getStudentAdminDetail } from '@/server/services/admin-users'
import { getQuota } from '@/server/services/job-view-quota'
import { NotFoundError } from '@/server/errors'
import { notFound } from 'next/navigation'
import { AdminStudentActions } from './admin-student-actions'
import { formatKLDate } from '@/lib/format-date'

export default async function AdminStudentDetailPage({
  params,
}: {
  params: Promise<{ locale: string; studentId: string }>
}) {
  const { locale, studentId } = await params
  const ctx = await requireAdmin(await headers())
  const t = await getTranslations('adminStudents')

  let detail
  try {
    detail = await getStudentAdminDetail(ctx, studentId)
  } catch (err) {
    if (err instanceof NotFoundError) return notFound()
    throw err
  }

  const quota = detail.profileId
    ? await getQuota(detail.profileId).catch(() => null)
    : null

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="mb-6 flex items-center gap-3">
        <Link
          href={`/${locale}/admin/students`}
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          ← {t('backToList')}
        </Link>
      </div>

      <h1 className="text-2xl font-bold mb-2">{detail.fullName}</h1>
      <p className="text-muted-foreground text-sm mb-6">{detail.email}</p>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Basic info */}
        <div className="rounded-lg border p-5 space-y-3">
          <h2 className="font-semibold text-base">{t('sectionBasicInfo')}</h2>
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between">
              <dt className="text-muted-foreground">{t('fieldStatus')}</dt>
              <dd>
                <span
                  className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs ${
                    detail.status === 'ACTIVE'
                      ? 'bg-green-100 text-green-800'
                      : detail.status === 'SUSPENDED'
                      ? 'bg-red-100 text-red-800'
                      : 'bg-gray-100 text-gray-600'
                  }`}
                >
                  {t(`status_${detail.status.toLowerCase()}` as 'status_active')}
                </span>
              </dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted-foreground">{t('fieldEmailVerified')}</dt>
              <dd>{detail.emailVerified ? t('yes') : t('no')}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted-foreground">{t('fieldCompleteness')}</dt>
              <dd>{detail.completeness}%</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted-foreground">{t('fieldVisibility')}</dt>
              <dd>{detail.visibility}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted-foreground">{t('fieldSchoolVerified')}</dt>
              <dd>
                {detail.schoolVerifiedAt
                  ? formatKLDate(detail.schoolVerifiedAt, locale)
                  : t('no')}
              </dd>
            </div>
            {detail.schoolEmail && (
              <div className="flex justify-between">
                <dt className="text-muted-foreground">{t('fieldSchoolEmail')}</dt>
                <dd className="font-mono text-xs">{detail.schoolEmail}</dd>
              </div>
            )}
            {detail.degreeLevel && (
              <div className="flex justify-between">
                <dt className="text-muted-foreground">{t('fieldDegreeLevel')}</dt>
                <dd>{detail.degreeLevel}</dd>
              </div>
            )}
            {detail.major && (
              <div className="flex justify-between">
                <dt className="text-muted-foreground">{t('fieldMajor')}</dt>
                <dd>{detail.major}</dd>
              </div>
            )}
            {detail.graduationYear && (
              <div className="flex justify-between">
                <dt className="text-muted-foreground">{t('fieldGradYear')}</dt>
                <dd>{detail.graduationYear}</dd>
              </div>
            )}
            {detail.nationality && (
              <div className="flex justify-between">
                <dt className="text-muted-foreground">{t('fieldNationality')}</dt>
                <dd>{detail.nationality}</dd>
              </div>
            )}
            {detail.workAuth && (
              <div className="flex justify-between">
                <dt className="text-muted-foreground">{t('fieldWorkAuth')}</dt>
                <dd>{detail.workAuth}</dd>
              </div>
            )}
            {detail.skills.length > 0 && (
              <div>
                <dt className="text-muted-foreground mb-1">{t('fieldSkills')}</dt>
                <dd className="flex flex-wrap gap-1">
                  {detail.skills.map((s) => (
                    <span key={s} className="rounded bg-muted px-2 py-0.5 text-xs">{s}</span>
                  ))}
                </dd>
              </div>
            )}
          </dl>
        </div>

        {/* Quota info */}
        {quota && (
          <div className="rounded-lg border p-5 space-y-3">
            <h2 className="font-semibold text-base">{t('sectionQuota')}</h2>
            <dl className="space-y-2 text-sm">
              <div className="flex justify-between">
                <dt className="text-muted-foreground">{t('quotaUsed')}</dt>
                <dd>{quota.used}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted-foreground">{t('quotaLimit')}</dt>
                <dd>{quota.limit === null ? t('unlimited') : quota.limit}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted-foreground">{t('quotaQualified')}</dt>
                <dd>{quota.qualified}</dd>
              </div>
            </dl>
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="mt-8">
        <h2 className="font-semibold text-base mb-4">{t('sectionActions')}</h2>
        <AdminStudentActions
          studentUserId={detail.userId}
          currentStatus={detail.status}
          schoolVerifiedAt={detail.schoolVerifiedAt}
        />
      </div>
    </div>
  )
}
