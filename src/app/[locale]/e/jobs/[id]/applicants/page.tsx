import { headers } from 'next/headers'
import { notFound } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { Link } from '@/i18n/navigation'
import { requireVerifiedCompany } from '@/server/authz'
import { listJobApplicants } from '@/server/services/applicants'
import { NotFoundError } from '@/server/errors'
import ApplicantsBoard from '@/components/applicants/applicants-board'
import { changeStatusAction, updateNoteAction } from './actions'

export default async function ApplicantsPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>
}) {
  const { locale, id } = await params
  const h = await headers()
  const t = await getTranslations('applicants')

  const ctx = await requireVerifiedCompany('RECRUITER', h)

  let result: Awaited<ReturnType<typeof listJobApplicants>>
  try {
    result = await listJobApplicants(ctx, id)
  } catch (err) {
    if (err instanceof NotFoundError) return notFound()
    throw err
  }

  const { applicants, jobTitle } = result

  return (
    <div className="container mx-auto max-w-6xl px-4 py-8">
      <div className="mb-6 flex items-center gap-3">
        <Link
          href={`/e/jobs`}
          className="text-sm text-muted-foreground hover:underline"
        >
          ← {t('backToJobs')}
        </Link>
      </div>
      <h1 className="mb-6 text-2xl font-bold">{t('title', { jobTitle })}</h1>

      <ApplicantsBoard
        applicants={applicants}
        locale={locale}
        t={{
          kanbanView: t('kanbanView'),
          listView: t('listView'),
          noApplicants: t('noApplicants'),
          statusAPPLIED: t('status.APPLIED'),
          statusVIEWED: t('status.VIEWED'),
          statusSHORTLISTED: t('status.SHORTLISTED'),
          statusINTERVIEW: t('status.INTERVIEW'),
          statusOFFER: t('status.OFFER'),
          statusHIRED: t('status.HIRED'),
          statusREJECTED: t('status.REJECTED'),
          statusWITHDRAWN: t('status.WITHDRAWN'),
          noteLabel: t('noteLabel'),
          notePlaceholder: t('notePlaceholder'),
          noteSave: t('noteSave'),
          noteSaving: t('noteSaving'),
          noteCancel: t('noteCancel'),
          noteSuccess: t('noteSuccess'),
          sortByCgpa: t('sortByCgpa'),
          sortByGradYear: t('sortByGradYear'),
          sortByCompleteness: t('sortByCompleteness'),
          changeStatusLabel: t('changeStatusLabel'),
          errorUnknown: t('errorUnknown'),
          errorForbidden: t('errorForbidden'),
          coverNoteLabel: t('coverNoteLabel'),
          identityLocked: t('identityLocked'),
          viewProfile: t('viewProfile'),
        }}
        changeStatusAction={changeStatusAction}
        updateNoteAction={updateNoteAction}
      />
    </div>
  )
}
