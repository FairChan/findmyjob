import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { requireAdmin } from '@/server/authz'
import { ForbiddenError, TwoFactorRequiredError, ValidationError } from '@/server/errors'
import { listArticlesAdmin, listArticlesAdminSchema } from '@/server/services/articles'
import { formatKLDateTime } from '@/lib/format-date'
import { ArticleForm } from './article-form'

export default async function ArticlesPage({ params, searchParams }: {
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
  const t = await getTranslations('adminArticles')
  const raw = await searchParams
  const parsed = listArticlesAdminSchema.safeParse({ category: raw.category === '' ? undefined : raw.category, cursor: raw.cursor })
  let invalid = !parsed.success
  let result: Awaited<ReturnType<typeof listArticlesAdmin>> = { items: [], nextCursor: null }
  if (parsed.success) {
    try {
      result = await listArticlesAdmin(ctx, { ...parsed.data, limit: 25 })
    } catch (error) {
      if (!(error instanceof ValidationError)) throw error
      invalid = true
    }
  }
  const query: Parameters<typeof listArticlesAdmin>[1] = parsed.success ? parsed.data : {}
  const path = '/' + locale + '/admin/articles'
  const next = new URLSearchParams()
  if (query.category) next.set('category', query.category)
  if (result.nextCursor) next.set('cursor', result.nextCursor)

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6 p-4 md:p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0"><h1 className="text-2xl font-semibold">{t('title')}</h1><p className="mt-2 text-sm text-gray-600">{t('description')}</p></div>
        <ArticleForm />
      </div>
      <form method="GET" action={path} className="flex flex-wrap items-end gap-3">
        <div className="min-w-0 flex-1 space-y-1 text-sm font-medium"><label htmlFor="article-category-filter">{t('category')}</label>
          <select id="article-category-filter" name="category" defaultValue={query.category ?? ''} className="h-10 w-full rounded-lg border border-gray-300 bg-white px-3 text-sm focus-visible:outline-2 focus-visible:outline-blue-600">
            <option value="">{t('all')}</option>
            {(['FRAUD_CASE', 'GUIDE', 'CONTACT'] as const).map((category) => <option key={category} value={category}>{t('categories.' + category)}</option>)}
          </select>
        </div>
        <button type="submit" className="h-10 rounded-lg bg-blue-700 px-4 text-sm font-medium text-white hover:bg-blue-800">{t('filter')}</button>
        <a href={path} className="inline-flex min-h-10 items-center text-sm text-blue-700 underline underline-offset-2">{t('reset')}</a>
      </form>
      {invalid ? <p role="alert" className="rounded-lg border border-red-200 bg-white p-4 text-sm text-red-800">{t('errorQuery')}</p> : (
        <div className="space-y-3">
          {result.items.length === 0 && <p className="rounded-xl border border-gray-200 bg-white p-6 text-sm text-gray-600">{t('empty')}</p>}
          {result.items.map((row) => (
            <article key={row.id} data-testid={'article-' + row.id} className="min-w-0 space-y-4 rounded-xl border border-gray-200 bg-white p-4 sm:p-5">
              <div className="flex flex-wrap items-start justify-between gap-3"><h2 className="min-w-0 flex-1 break-words font-semibold [overflow-wrap:anywhere]">{row.title}</h2><ArticleForm article={{ id: row.id, category: row.category, title: row.title, body: row.body, videoUrl: row.videoUrl, sortOrder: row.sortOrder, published: row.published }} /></div>
              <div className="flex flex-wrap gap-2 text-xs"><span className="rounded-full bg-gray-100 px-3 py-1 font-semibold text-gray-800">{t(row.published ? 'published' : 'draft')}</span><span className="rounded-full bg-blue-50 px-3 py-1 text-blue-900">{t('categories.' + row.category)}</span></div>
              <dl className="flex flex-wrap gap-x-8 gap-y-2 text-xs text-gray-600"><div><dt className="inline">{t('order')}: </dt><dd className="inline">{row.sortOrder}</dd></div><div><dt className="inline">{t('updatedAt')}: </dt><dd className="inline">{formatKLDateTime(row.updatedAt, locale)}</dd></div></dl>
            </article>
          ))}
        </div>
      )}
      {!invalid && result.nextCursor && <a href={path + '?' + next.toString()} className="inline-flex min-h-10 items-center rounded-lg border border-gray-300 bg-white px-4 text-sm">{t('next')}</a>}
    </div>
  )
}

