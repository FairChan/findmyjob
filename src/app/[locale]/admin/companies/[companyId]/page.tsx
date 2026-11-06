import { notFound } from 'next/navigation'
import Link from 'next/link'
import { getTranslations } from 'next-intl/server'
import { headers } from 'next/headers'
import { requireAdmin } from '@/server/authz'
import { getCompanyForReview } from '@/server/services/review-company'
import { getSignedDownloadUrl } from '@/lib/storage'
import { ReviewForm } from './ReviewForm'

export default async function AdminCompanyReviewPage({
  params,
}: {
  params: Promise<{ locale: string; companyId: string }>
}) {
  const { locale, companyId } = await params
  const ctx = await requireAdmin(await headers())
  const t = await getTranslations('adminCompanies')

  const company = await getCompanyForReview(ctx, companyId)
  if (!company) return notFound()

  const cv = company.verifications[0] ?? null
  const owner = company.members[0] ?? null

  // Generate signed URLs for each document (max 5, TTL 300s)
  const docUrls: { url: string; name: string }[] = []
  if (cv) {
    for (let i = 0; i < cv.documentKeys.length; i++) {
      const key = cv.documentKeys[i]
      const name = key.split('/').pop() ?? `document-${i + 1}`
      try {
        const url = await getSignedDownloadUrl(key, name)
        docUrls.push({ url, name })
      } catch {
        docUrls.push({ url: '#', name })
      }
    }
  }

  return (
    <main id="main-content" className="p-6 max-w-4xl mx-auto">
      <Link
        href={`/${locale}/admin/companies`}
        className="text-sm text-muted-foreground hover:underline mb-4 inline-block"
      >
        ← {t('back')}
      </Link>

      <h1 className="text-2xl font-bold mb-6">{t('detailTitle')}</h1>

      {/* Company info */}
      <section className="rounded-lg border p-5 mb-6 space-y-2">
        <h2 className="font-semibold mb-3">{t('companyInfoTitle')}</h2>
        <dl className="grid grid-cols-[auto,1fr] gap-x-4 gap-y-1 text-sm">
          <dt className="text-muted-foreground">{t('legalName')}</dt>
          <dd className="font-medium">{company.legalName}</dd>
          {company.ssmRegNo && (
            <>
              <dt className="text-muted-foreground">{t('ssmRegNo')}</dt>
              <dd>{company.ssmRegNo}</dd>
            </>
          )}
          {company.website && (
            <>
              <dt className="text-muted-foreground">{t('website')}</dt>
              <dd>
                <a
                  href={company.website}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline underline-offset-2"
                >
                  {company.website}
                </a>
              </dd>
            </>
          )}
          {owner && (
            <>
              <dt className="text-muted-foreground">{t('owner')}</dt>
              <dd>{owner.user.email}</dd>
            </>
          )}
        </dl>
      </section>

      {/* Verification documents */}
      <section className="rounded-lg border p-5 mb-6">
        <h2 className="font-semibold mb-3">{t('docsTitle')}</h2>
        {!cv ? (
          <p className="text-sm text-muted-foreground">{t('noVerification')}</p>
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
                  {t('viewDoc', { index: i + 1 })} — {doc.name}
                </a>
              </li>
            ))}
          </ul>
        )}
        {cv?.note && (
          <p className="mt-3 text-sm text-muted-foreground">
            <span className="font-medium">{t('noteLabel')}:</span> {cv.note}
          </p>
        )}
      </section>

      {/* SOP hint */}
      <div className="rounded-lg bg-amber-50 border border-amber-200 p-4 mb-6 text-sm text-amber-900">
        {t('sopHint')}
      </div>

      {/* Review form — only show when there is a pending verification */}
      {cv && cv.status === 'PENDING' ? (
        <ReviewForm verificationId={cv.id} companyId={companyId} />
      ) : (
        <p className="text-sm text-muted-foreground">{t('noVerification')}</p>
      )}
    </main>
  )
}
