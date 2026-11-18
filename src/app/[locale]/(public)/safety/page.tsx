import { Select } from '@/components/ui/select'
import type { Metadata } from 'next'
import { getTranslations } from 'next-intl/server'
import { Link } from '@/i18n/navigation'
import { Button } from '@/components/ui/button'
import { BouncyAccordion } from '@/components/ui/bouncy-accordion'
import { ShieldCheck } from 'lucide-react'
import { FIELD_CLASS } from '@/components/ui/field'
import { PageHeader } from '@/components/ui/page-header'
import { BrandLine } from '@/components/layout/brand-line'
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
    <div className="page-shell pb-20 pt-10 md:pt-14">
      <PageHeader eyebrow={<BrandLine word="safe" />} title={t('title')} lead={t('description')} />

      <form
        action={`/${locale}/safety`}
        method="get"
        className="mt-8 flex flex-wrap items-end gap-3 rounded-card bg-muted p-4"
      >
        <div className="w-full space-y-2 sm:w-auto sm:min-w-60">
          <label htmlFor="safety-category" className="block text-sm font-medium">{t('category')}</label>
          <Select
            key={category ?? 'all'}
            id="safety-category"
            name="category"
            defaultValue={category ?? ''}
            className={FIELD_CLASS}
          >
            <option value="">{t('all')}</option>
            {categories.map((value) => <option key={value} value={value}>{t(`categories.${value}`)}</option>)}
          </Select>
        </div>
        <Button type="submit" className="h-11">{t('filter')}</Button>
        <Link
          href="/safety"
          className="inline-flex min-h-11 items-center rounded-full px-3 text-sm text-brand underline-offset-4 hover:underline"
        >
          {t('reset')}
        </Link>
      </form>

      <div className="mt-8 grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_17rem]">
        <div className="min-w-0 space-y-4">
          {invalidQuery ? (
            <p role="alert" className="rounded-card bg-destructive-muted p-5 text-sm text-destructive">{t('errorQuery')}</p>
          ) : page.items.length === 0 ? (
            <p className="rounded-card bg-muted p-6 text-sm text-muted-foreground">{t('empty')}</p>
          ) : (
            // One article open at a time keeps a long list scannable.
            <BouncyAccordion
              key={page.items.map((article) => article.id).join()}
              defaultValue={page.items[0]?.id ?? null}
              classNames={{
                item: 'bg-muted',
                trigger: 'min-h-16',
                title: 'text-body font-semibold',
                description: 'text-foreground',
              }}
              items={page.items.map((article) => ({
                id: article.id,
                testId: `safety-article-${article.id}`,
                icon: <ShieldCheck aria-hidden="true" className="size-5" strokeWidth={1.75} />,
                title: (
                  <>
                    <span className="block text-xs font-medium text-brand-muted-foreground">
                      {t(`categories.${article.category}`)}
                    </span>
                    <span className="mt-0.5 block [overflow-wrap:anywhere]">{article.title}</span>
                  </>
                ),
                description: (
                  <div className="space-y-4">
                    <p className="text-xs text-muted-foreground">
                      <time dateTime={article.updatedAt.toISOString()}>{t('updatedAt', { date: dateFormat.format(article.updatedAt) })}</time>
                    </p>
                    <SafetyArticleContent body={article.body} videoUrl={article.videoUrl} videoLinkLabel={t('video')} />
                  </div>
                ),
              }))}
            />
          )}
          {page.nextCursor && (
            <div className="flex justify-end">
              <Button asChild variant="secondary">
                <Link href={`/safety?${nextQuery.toString()}`}>{t('next')}</Link>
              </Button>
            </div>
          )}
        </div>
        <aside className="rounded-card bg-brand-muted p-6 lg:sticky lg:top-20">
          <h2 className="text-body font-semibold text-brand-muted-foreground">{t('emergencyTitle')}</h2>
          <p className="mt-2 text-sm leading-6 text-brand-muted-foreground">{t('emergency')}</p>
          <p className="mt-4 border-t border-brand/20 pt-4 text-sm leading-6 text-brand-muted-foreground">{t('verifiedContacts')}</p>
        </aside>
      </div>
    </div>
  )
}
