'use client'

import { useId, useRef, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { useRouter } from 'next/navigation'
import type { ArticleCategory } from '@prisma/client'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { SafetyArticleContent } from '@/components/safety/safety-article'
import { saveArticleAction } from '@/server/actions/admin-articles'

interface Article {
  id: string
  category: ArticleCategory
  title: string
  body: string
  videoUrl: string | null
  sortOrder: number
  published: boolean
}
const fieldClass = 'w-full min-w-0 rounded-card border border-border bg-card px-3 py-2 text-base focus-visible:outline-2 focus-visible:outline-brand'

export function ArticleForm({ article }: { article?: Article }) {
  const t = useTranslations('adminArticles')
  const locale = useLocale()
  const router = useRouter()
  const id = useId()
  const inFlight = useRef(false)
  const [open, setOpen] = useState(false)
  const [category, setCategory] = useState<ArticleCategory>(article?.category ?? 'GUIDE')
  const [title, setTitle] = useState(article?.title ?? '')
  const [body, setBody] = useState(article?.body ?? '')
  const [videoUrl, setVideoUrl] = useState(article?.videoUrl ?? '')
  const [sortOrder, setSortOrder] = useState(String(article?.sortOrder ?? 0))
  const [published, setPublished] = useState(article?.published ?? false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const [authCode, setAuthCode] = useState('')
  const [saved, setSaved] = useState(false)

  function changeOpen(value: boolean) {
    if (inFlight.current) return
    if (value) {
      setCategory(article?.category ?? 'GUIDE')
      setTitle(article?.title ?? '')
      setBody(article?.body ?? '')
      setVideoUrl(article?.videoUrl ?? '')
      setSortOrder(String(article?.sortOrder ?? 0))
      setPublished(article?.published ?? false)
      setError('')
      setAuthCode('')
      setSaved(false)
    }
    setOpen(value)
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (inFlight.current) return
    setError('')
    setAuthCode('')
    const order = Number(sortOrder)
    let validVideo = true
    if (videoUrl.trim()) {
      try {
        const url = new URL(videoUrl.trim())
        validVideo = ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password && videoUrl.trim().length <= 2048
      } catch {
        validVideo = false
      }
    }
    if (!title.trim() || title.trim().length > 200 || !body.trim() || body.trim().length > 50_000 || !sortOrder.trim() || !Number.isSafeInteger(order) || order < 0 || order > 10_000 || !validVideo) {
      setError(t('errorInvalid'))
      return
    }
    inFlight.current = true
    setPending(true)
    try {
      const result = await saveArticleAction({
        ...(article ? { id: article.id } : {}),
        category, title: title.trim(), body: body.trim(), videoUrl: videoUrl.trim(), sortOrder: order, published,
      })
      if (result.ok) {
        setOpen(false)
        setSaved(true)
        router.refresh()
      } else {
        setAuthCode(result.code)
        setError(t(result.code === 'VALIDATION_ERROR' ? 'errorInvalid' : result.code === 'NOT_FOUND' ? 'errorNotFound' : result.code === 'TWO_FACTOR_REQUIRED' ? 'errorTwoFactor' : ['FORBIDDEN', 'FRESH_SESSION_REQUIRED'].includes(result.code) ? 'errorForbidden' : 'errorGeneric'))
      }
    } catch {
      setError(t('errorGeneric'))
    } finally {
      inFlight.current = false
      setPending(false)
    }
  }

  return (
    <div className="min-w-0 space-y-2">
      {saved && <p role="status" className="text-sm text-success">{t('saved')}</p>}
      <Dialog open={open} onOpenChange={changeOpen}>
        <DialogTrigger asChild><Button variant={article ? 'outline' : 'default'} size={article ? 'sm' : 'default'}>{t(article ? 'edit' : 'new')}</Button></DialogTrigger>
        <DialogContent closeLabel={t('close')} className="max-h-[90dvh] w-[calc(100%_-_2rem)] max-w-4xl overflow-y-auto rounded-card" onEscapeKeyDown={(event) => { if (pending) event.preventDefault() }} onPointerDownOutside={(event) => { if (pending) event.preventDefault() }}>
          <DialogHeader><DialogTitle>{t(article ? 'editTitle' : 'new')}</DialogTitle><DialogDescription>{t('description')}</DialogDescription></DialogHeader>
          <form data-testid="article-form" onSubmit={submit} className="min-w-0 space-y-5" aria-busy={pending}>
            <div className="grid min-w-0 gap-4 sm:grid-cols-2">
              <div className="min-w-0 space-y-2"><label htmlFor={id + '-category'} className="text-sm font-medium">{t('category')}</label><select id={id + '-category'} value={category} onChange={(event) => setCategory(event.target.value as ArticleCategory)} disabled={pending} className={fieldClass}>{(['FRAUD_CASE', 'GUIDE', 'CONTACT'] as const).map((value) => <option key={value} value={value}>{t('categories.' + value)}</option>)}</select></div>
              <div className="min-w-0 space-y-2"><label htmlFor={id + '-order'} className="text-sm font-medium">{t('order')}</label><input id={id + '-order'} type="number" min={0} max={10000} step={1} required value={sortOrder} onChange={(event) => setSortOrder(event.target.value)} disabled={pending} aria-describedby={id + '-order-hint'} className={fieldClass} /><p id={id + '-order-hint'} className="text-xs text-muted-foreground">{t('orderHint')}</p></div>
              <div className="min-w-0 space-y-2 sm:col-span-2"><label htmlFor={id + '-title'} className="text-sm font-medium">{t('articleTitle')}</label><input id={id + '-title'} required maxLength={200} value={title} onChange={(event) => setTitle(event.target.value)} disabled={pending} className={fieldClass} /></div>
              <div className="min-w-0 space-y-2 sm:col-span-2"><label htmlFor={id + '-body'} className="text-sm font-medium">{t('body')}</label><textarea id={id + '-body'} rows={8} required maxLength={50000} value={body} onChange={(event) => setBody(event.target.value)} disabled={pending} aria-describedby={id + '-body-hint'} className={fieldClass} /><p id={id + '-body-hint'} className="text-xs text-muted-foreground">{t('bodyHint')}</p></div>
              <div className="min-w-0 space-y-2 sm:col-span-2"><label htmlFor={id + '-video'} className="text-sm font-medium">{t('video')}</label><input id={id + '-video'} type="url" maxLength={2048} value={videoUrl} onChange={(event) => setVideoUrl(event.target.value)} disabled={pending} aria-describedby={id + '-video-hint'} className={fieldClass} /><p id={id + '-video-hint'} className="text-xs text-muted-foreground">{t('videoHint')}</p></div>
              <div className="min-w-0 space-y-2 sm:col-span-2"><label className="flex min-h-10 items-center gap-3 text-sm font-medium"><input type="checkbox" checked={published} onChange={(event) => setPublished(event.target.checked)} disabled={pending} aria-describedby={id + '-publish-hint'} className="size-4 accent-brand" />{t('published')}</label><p id={id + '-publish-hint'} className="text-xs text-muted-foreground">{t('publishHint')}</p></div>
            </div>
            <section aria-label={t('preview')} className="min-w-0 rounded-card border border-border bg-muted p-4">
              <h3 className="mb-3 text-sm font-semibold">{t('preview')}</h3>
              {body.trim() ? <SafetyArticleContent body={body} videoUrl={videoUrl} videoLinkLabel={t('viewVideo')} /> : <p className="text-sm text-muted-foreground">{t('previewEmpty')}</p>}
            </section>
            {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
            {['FORBIDDEN', 'FRESH_SESSION_REQUIRED', 'TWO_FACTOR_REQUIRED'].includes(authCode) && <a className="block text-sm text-brand underline" href={'/' + locale + (authCode === 'TWO_FACTOR_REQUIRED' ? '/two-factor/setup' : '/login')}>{t(authCode === 'TWO_FACTOR_REQUIRED' ? 'setupTwoFactor' : 'signIn')}</a>}
            <DialogFooter><Button type="button" variant="outline" disabled={pending} onClick={() => setOpen(false)}>{t('cancel')}</Button><Button type="submit" disabled={pending}>{t(pending ? 'saving' : 'save')}</Button></DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}

