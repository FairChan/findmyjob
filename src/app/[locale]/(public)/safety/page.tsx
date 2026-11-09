import type { Metadata } from 'next'
import { getTranslations } from 'next-intl/server'
import { Link } from '@/i18n/navigation'
import { Button } from '@/components/ui/button'
import { SafetyArticleContent } from '@/components/safety/safety-article'
import { ValidationError } from '@/server/errors'
import {
  listPublishedArticles,
  listPublishedArticlesSchema,
  type PageResult,
  type PublicArticle,
} from '@/server/services/articles'

interface Props {
  params: Promise<{ locale: string }>
  searchParams: Promise<{ category?: string | string[]; cursor?: string | string[] }>
}

const categories = ['FRAUD_CASE', 'GUIDE', 'CONTACT'] as const

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'safety' })
  return { title: t('title'), description: t('description') }
}

export default async function SafetyPage({ params, searchParams }: Props) {
  const [{ locale }, query] = await Promise.all([params, searchParams])
  const t = await getTranslations({ locale, namespace: 'safety' })
  const parsed = listPublishedArticlesSchema.safeParse({
    category: query.category === '' ? undefined : query.category,
    cursor: query.cursor,
  })
  let invalidQuery = !parsed.success
  let page: PageResult<PublicArticle> = { items: [], nextCursor: null }
  if (parsed.success) {
    try {
      page = await listPublishedArticles(parsed.data)
    } catch (error) {
      if (!(error instanceof ValidationError)) throw error
      invalidQuery = true
    }
  }

  const category = parsed.success ? parsed.data.category : undefined
  const nextQuery = new URLSearchParams()
  if (category) nextQuery.set('category', category)
  if (page.nextCursor) nextQuery.set('cursor', page.nextCursor)
  const dateFormat = new Intl.DateTimeFormat(locale === 'zh' ? 'zh-CN' : 'en-MY', {
    dateStyle: 'medium',
    timeZone: 'Asia/Kuala_Lumpur',
  })

  return (
    <div className="container mx-auto max-w-5xl px-4 py-8 sm:py-12">
      <div className="mb-8 max-w-2xl">
        <h1 className="text-3xl font-bold tracking-tight">{t('title')}</h1>
        <p className="mt-3 text-sm leading-7 text-muted-foreground">{t('description')}</p>
      </div>

      <form action={`/${locale}/safety`} method="get" className="mb-6 flex flex-wrap items-end gap-3 rounded-lg border bg-card p-4">
        <div className="w-full space-y-2 sm:w-auto sm:min-w-60">
          <label htmlFor="safety-category" className="block text-sm font-medium">{t('category')}</label>
          <select
            key={category ?? 'all'}
            id="safety-category"
            name="category"
            defaultValue={category ?? ''}
            className="min-h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            <option value="">{t('all')}</option>
            {categories.map((value) => <option key={value} value={value}>{t(`categories.${value}`)}</option>)}
          </select>
        </div>
        <Button type="submit">{t('filter')}</Button>
        <Link href="/safety" className="inline-flex min-h-10 items-center rounded-md px-3 text-sm font-medium text-brand hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">
          {t('reset')}
        </Link>
      </form>

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_16rem]">
        <div className="min-w-0 space-y-5">
          {invalidQuery ? (
            <p role="alert" className="rounded-lg border border-destructive/40 bg-card p-5 text-sm text-destructive">{t('errorQuery')}</p>
          ) : page.items.length === 0 ? (
            <p className="rounded-lg border bg-muted/30 p-6 text-sm text-muted-foreground">{t('empty')}</p>
          ) : page.items.map((article) => (
            <article key={article.id} data-testid={`safety-article-${article.id}`} className="min-w-0 space-y-4 rounded-lg border bg-card p-5 sm:p-6">
              <div className="space-y-2">
                <p className="text-xs font-medium text-brand-muted-foreground">{t(`categories.${article.category}`)}</p>
                <h2 className="break-words text-xl font-semibold [overflow-wrap:anywhere]">{article.title}</h2>
                <p className="text-xs text-muted-foreground">
                  <time dateTime={article.updatedAt.toISOString()}>{t('updatedAt', { date: dateFormat.format(article.updatedAt) })}</time>
                </p>
              </div>
              <SafetyArticleContent body={article.body} videoUrl={article.videoUrl} videoLinkLabel={t('video')} />
            </article>
          ))}
          {page.nextCursor && (
            <div className="flex justify-end">
              <Button asChild variant="outline">
                <Link href={`/safety?${nextQuery.toString()}`}>{t('next')}</Link>
              </Button>
            </div>
          )}
        </div>
        <aside className="rounded-lg border border-brand/20 bg-brand-muted p-5 lg:sticky lg:top-20">
          <h2 className="text-base font-semibold text-brand-muted-foreground">{t('emergencyTitle')}</h2>
          <p className="mt-2 text-sm leading-6 text-brand-muted-foreground">{t('emergency')}</p>
          <p className="mt-4 border-t border-brand/20 pt-4 text-sm leading-6 text-brand-muted-foreground">{t('verifiedContacts')}</p>
        </aside>
      </div>
    </div>
  )
}
