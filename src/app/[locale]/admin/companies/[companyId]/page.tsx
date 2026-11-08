import { notFound } from 'next/navigation'
import Link from 'next/link'
import { getTranslations } from 'next-intl/server'
import { headers } from 'next/headers'
import { requireAdmin } from '@/server/authz'
import { getCompanyForReview } from '@/server/services/review-company'
import { getCompanyAdminDetail } from '@/server/services/admin-companies'
import { ReviewForm } from './review-form'
import { AdminCompanyActions } from './admin-company-actions'

export default async function AdminCompanyDetailPage({
  params,
}: {
  params: Promise<{ locale: string; companyId: string }>
}) {
  const { locale, companyId } = await params
  const ctx = await requireAdmin(await headers())
  const tReview = await getTranslations('adminCompanies')
  const tManage = await getTranslations('adminCompanyManage')

  const [reviewData, adminDetail] = await Promise.all([
    getCompanyForReview(ctx, companyId),
    getCompanyAdminDetail(ctx, companyId),
  ])
  if (!reviewData) return notFound()

  const cv = reviewData.verifications[0] ?? null
  const owner = reviewData.members[0] ?? null

  const docUrls: { url: string; name: string }[] = []
  if (cv) {
    for (let i = 0; i < cv.documentKeys.length; i++) {
      const key = cv.documentKeys[i]
      const name = key.split('/').pop() ?? `document-${i + 1}`
      docUrls.push({ url: `/api/admin/verification-docs/${cv.id}/${i}`, name })
    }
  }

  return (
    <main id="main-content" className="p-6 max-w-4xl mx-auto">
      <Link
        href={`/${locale}/admin/companies`}
        className="text-sm text-muted-foreground hover:underline mb-4 inline-block"
      >
        ← {tReview('back')}
      </Link>

      <h1 className="text-2xl font-bold mb-6">{reviewData.legalName}</h1>

      {/* Company info */}
      <section className="rounded-lg border p-5 mb-6 space-y-2">
        <h2 className="font-semibold mb-3">{tReview('companyInfoTitle')}</h2>
        <dl className="grid grid-cols-[auto,1fr] gap-x-4 gap-y-1 text-sm">
          <dt className="text-muted-foreground">{tReview('legalName')}</dt>
          <dd className="font-medium">{reviewData.legalName}</dd>
          {reviewData.ssmRegNo && (
            <>
              <dt className="text-muted-foreground">{tReview('ssmRegNo')}</dt>
              <dd>{reviewData.ssmRegNo}</dd>
            </>
          )}
          {reviewData.website && (
            <>
              <dt className="text-muted-foreground">{tReview('website')}</dt>
              <dd>
                <a
                  href={reviewData.website}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline underline-offset-2"
                >
                  {reviewData.website}
                </a>
              </dd>
            </>
          )}
          {owner && (
            <>
              <dt className="text-muted-foreground">{tReview('owner')}</dt>
              <dd>{owner.user.email}</dd>
            </>
          )}
        </dl>
      </section>

      {/* Verification documents */}
      <section className="rounded-lg border p-5 mb-6">
        <h2 className="font-semibold mb-3">{tReview('docsTitle')}</h2>
        {!cv ? (
          <p className="text-sm text-muted-foreground">{tReview('noVerification')}</p>
        ) : (
          <ul className="space-y-2">
            {docUrls.map((doc, i) => (
              <li key={i}>
                <a
                  href={doc.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm text-primary underline underline-offset-2"
                >
                  {tReview('viewDoc', { index: i + 1 })} — {doc.name}
                </a>
              </li>
            ))}
          </ul>
        )}
        {cv?.note && (
          <p className="mt-3 text-sm text-muted-foreground">
            <span className="font-medium">{tReview('noteLabel')}:</span> {cv.note}
          </p>
        )}
      </section>

      {/* SOP hint */}
      <div className="rounded-lg bg-amber-50 border border-amber-200 p-4 mb-6 text-sm text-amber-900">
        {tReview('sopHint')}
      </div>

      {/* Review form — only show when there is a pending verification */}
      {cv && cv.status === 'PENDING' ? (
        <div className="mb-8">
          <ReviewForm verificationId={cv.id} companyId={companyId} />
        </div>
      ) : (
        <p className="text-sm text-muted-foreground mb-8">{tReview('noVerification')}</p>
      )}

      {/* Admin management section */}
      <section>
        <h2 className="text-xl font-semibold mb-4">{tManage('manageTitle')}</h2>
        <AdminCompanyActions
          companyId={companyId}
          isActive={adminDetail.isActive}
          isFoundingPartner={adminDetail.isFoundingPartner}
          currentTags={adminDetail.tags}
          walletBalance={adminDetail.walletBalance}
        />
      </section>
    </main>
  )
}
