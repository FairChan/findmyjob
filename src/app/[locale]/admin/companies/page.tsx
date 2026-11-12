import { getTranslations } from 'next-intl/server'
import Link from 'next/link'
import { headers } from 'next/headers'
import { z } from 'zod'
import { VerificationStatus } from '@prisma/client'
import { requireAdmin } from '@/server/authz'
import { searchCompanies } from '@/server/services/admin-companies'
import { formatKLDate } from '@/lib/format-date'

const VALID_VERIFICATION_STATUSES = Object.values(VerificationStatus) as string[]

const listParamsSchema = z.object({
  q: z.string().max(200).optional(),
  active: z.string().optional(),
  status: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
})

export default async function AdminCompaniesPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>
  searchParams: Promise<{ q?: string; active?: string; status?: string; page?: string }>
}) {
  const { locale } = await params
  const sp = await searchParams
  const ctx = await requireAdmin(await headers())
  const t = await getTranslations('adminCompanyManage')

  const parsed = listParamsSchema.safeParse({
    q: sp.q?.slice(0, 200),
    active: sp.active,
    status: sp.status,
    page: sp.page,
  })
  const listParams = parsed.success
    ? parsed.data
    : { q: undefined, active: undefined, status: undefined, page: 1 }
  const { q, active, status, page } = listParams

  const isActiveFilter: boolean | undefined =
    active === 'true' ? true : active === 'false' ? false : undefined

  const verificationStatusFilter =
    status && VALID_VERIFICATION_STATUSES.includes(status)
      ? (status as VerificationStatus)
      : undefined

  const { items, total } = await searchCompanies(ctx, {
    q,
    isActive: isActiveFilter,
    verificationStatus: verificationStatusFilter,
    page: typeof page === 'number' ? page : 1,
  })
  const pageSize = 20
  const totalPages = Math.ceil(total / pageSize)
  const currentPage = typeof page === 'number' ? page : 1

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <h1 className="text-2xl font-bold mb-6">{t('title')}</h1>

      {/* Search bar */}
      <form method="GET" className="flex flex-wrap gap-2 mb-6">
        <input
          type="text"
          name="q"
          defaultValue={q}
          placeholder={t('searchPlaceholder')}
          className="flex-1 min-w-[200px] rounded-control border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
        />
        <select
          name="status"
          defaultValue={status ?? ''}
          className="rounded-control border border-input bg-background px-3 py-2 text-sm"
        >
          <option value="">{t('filterVerificationAll')}</option>
          <option value="UNSUBMITTED">{t('verificationUnsubmitted')}</option>
          <option value="PENDING">{t('verificationPending')}</option>
          <option value="VERIFIED">{t('verificationVerified')}</option>
          <option value="REJECTED">{t('verificationRejected')}</option>
        </select>
        <select
          name="active"
          defaultValue={active ?? ''}
          className="rounded-control border border-input bg-background px-3 py-2 text-sm"
        >
          <option value="">{t('filterAll')}</option>
          <option value="true">{t('filterActive')}</option>
          <option value="false">{t('filterInactive')}</option>
        </select>
        <button
          type="submit"
          className="rounded-control bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          {t('searchBtn')}
        </button>
      </form>

      <p className="mb-4 text-sm text-muted-foreground">
        {t('totalCount', { count: total })}
      </p>

      {items.length === 0 ? (
        <p className="text-muted-foreground">—</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="text-left p-3 font-medium">{t('colName')}</th>
                <th className="text-left p-3 font-medium">{t('colStatus')}</th>
                <th className="text-left p-3 font-medium">{t('colActive')}</th>
                <th className="text-left p-3 font-medium">{t('colMembers')}</th>
                <th className="text-left p-3 font-medium">{t('colCredits')}</th>
                <th className="text-left p-3 font-medium">{t('colCreatedAt')}</th>
                <th className="p-3"></th>
              </tr>
            </thead>
            <tbody>
              {items.map((company) => (
                <tr key={company.id} className="border-b hover:bg-muted/30">
                  <td className="p-3 font-medium">
                    {company.legalName}
                    {company.isFoundingPartner && (
                      <span className="ml-2 inline-flex items-center rounded-full bg-warning-muted px-2 py-0.5 text-xs text-warning">
                        {t('foundingPartnerBadge')}
                      </span>
                    )}
                  </td>
                  <td className="p-3">
                    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs ${
                      company.verificationStatus === 'VERIFIED'
                        ? 'bg-success-muted text-success'
                        : company.verificationStatus === 'PENDING'
                        ? 'bg-warning-muted text-warning'
                        : company.verificationStatus === 'REJECTED'
                        ? 'bg-destructive-muted text-destructive'
                        : 'bg-muted text-muted-foreground'
                    }`}>
                      {t(`verification${company.verificationStatus.charAt(0).toUpperCase()}${company.verificationStatus.slice(1).toLowerCase()}` as 'verificationVerified')}
                    </span>
                  </td>
                  <td className="p-3">
                    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs ${
                      company.isActive ? 'bg-success-muted text-success' : 'bg-destructive-muted text-destructive'
                    }`}>
                      {company.isActive ? t('statusActive') : t('statusInactive')}
                    </span>
                  </td>
                  <td className="p-3 text-muted-foreground">{company.memberCount}</td>
                  <td className="p-3 text-muted-foreground">
                    {company.walletBalance !== null ? company.walletBalance : '—'}
                  </td>
                  <td className="p-3 text-muted-foreground">
                    {formatKLDate(company.createdAt, locale)}
                  </td>
                  <td className="p-3 text-right">
                    <Link
                      href={`/${locale}/admin/companies/${company.id}`}
                      className="text-primary underline-offset-4 hover:underline text-sm"
                    >
                      {t('detailAction')}
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="mt-6 flex gap-2 justify-center">
          {Array.from({ length: totalPages }, (_, i) => i + 1).map((p) => (
            <Link
              key={p}
              href={`/${locale}/admin/companies?${new URLSearchParams({
                ...(q ? { q } : {}),
                ...(status ? { status } : {}),
                ...(active ? { active } : {}),
                page: String(p),
              })}`}
              className={`rounded px-3 py-1 text-sm ${
                p === currentPage
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted hover:bg-muted/70'
              }`}
            >
              {p}
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
