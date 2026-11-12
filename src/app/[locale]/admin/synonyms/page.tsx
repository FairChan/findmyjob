import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { requireAdmin } from '@/server/authz'
import { ForbiddenError, TwoFactorRequiredError, ValidationError } from '@/server/errors'
import { listSynonyms, listSynonymsSchema } from '@/server/services/search-synonyms'
import { formatKLDateTime } from '@/lib/format-date'
import { SynonymForm } from './synonym-form'

export default async function SynonymsPage({ params, searchParams }: {
  params: Promise<{ locale: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { locale } = await params
  let ctx
  try {
    ctx = await requireAdmin(await headers())
  } catch (error) {
    if (error instanceof TwoFactorRequiredError) redirect('/' + locale + '/two-factor/setup')
    if (error instanceof ForbiddenError) redirect('/' + locale + '/login')
    throw error
  }
  const t = await getTranslations('adminSynonyms')
  const raw = await searchParams
  const parsed = listSynonymsSchema.safeParse({ cursor: raw.cursor })
  let invalid = !parsed.success
  let result: Awaited<ReturnType<typeof listSynonyms>> = { items: [], nextCursor: null }
  if (parsed.success) {
    try {
      result = await listSynonyms(ctx, { ...parsed.data, limit: 25 })
    } catch (error) {
      if (!(error instanceof ValidationError)) throw error
      invalid = true
    }
  }
  const path = '/' + locale + '/admin/synonyms'

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6 p-4 md:p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0"><h1 className="text-2xl font-semibold">{t('title')}</h1><p className="mt-2 text-sm text-muted-foreground">{t('description')}</p></div>
        <SynonymForm />
      </div>
      {invalid ? <div className="space-y-3"><p role="alert" className="rounded-card border border-destructive/30 bg-card p-4 text-sm text-destructive">{t('errorQuery')}</p><a href={path} className="text-sm text-brand underline underline-offset-2">{t('reset')}</a></div> : (
        <div className="space-y-3">
          {result.items.length === 0 && <p className="rounded-card border border-border bg-card p-6 text-sm text-muted-foreground">{t('empty')}</p>}
          {result.items.map((row) => (
            <article key={row.id} data-testid={'synonym-' + row.id} className="min-w-0 space-y-4 rounded-card border border-border bg-card p-4 sm:p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <span className="rounded-full bg-muted px-3 py-1 text-xs font-semibold text-foreground">{t(row.active ? 'active' : 'inactive')}</span>
                <SynonymForm group={{ id: row.id, terms: row.terms, active: row.active }} />
              </div>
              <ul className="flex min-w-0 flex-wrap gap-2">{row.terms.map((term) => <li key={term} className="max-w-full rounded-card border border-brand/30 bg-brand-muted px-3 py-1 text-sm text-brand [overflow-wrap:anywhere]">{term}</li>)}</ul>
              <p className="text-xs text-muted-foreground">{t('updatedAt')}: {formatKLDateTime(row.updatedAt, locale)}</p>
            </article>
          ))}
        </div>
      )}
      {!invalid && result.nextCursor && <a href={path + '?' + new URLSearchParams({ cursor: result.nextCursor }).toString()} className="inline-flex min-h-10 items-center rounded-card border border-border bg-card px-4 text-sm">{t('next')}</a>}
    </div>
  )
}

