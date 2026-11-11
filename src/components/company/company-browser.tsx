'use client'

import { useEffect, useRef, useTransition, type ReactNode } from 'react'
import { Check, MapPin } from 'lucide-react'
import { Link, useRouter } from '@/i18n/navigation'
import { cn } from '@/lib/utils'

interface BrowseCompany {
  id: string
  name: string
  hasLogo: boolean
  location: string
  jobCount: string
  href: string
}

interface CompanyBrowserProps {
  companies: BrowseCompany[]
  selectedId: string | null
  selectedName: string | null
  panel: ReactNode
  pagination: ReactNode
  empty: ReactNode
  labels: { selected: string; loading: string; selectedFeedback: string }
}

/** URL-backed selection with server-rendered, public-only panel contents. */
export function CompanyBrowser({ companies, selectedId, selectedName, panel, pagination, empty, labels }: CompanyBrowserProps) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const panelRef = useRef<HTMLDivElement>(null)
  const selectionRequested = useRef(false)

  function focusMobilePanel() {
    if (!window.matchMedia('(max-width: 1023px)').matches) return
    const heading = panelRef.current?.querySelector<HTMLElement>('[data-company-panel-heading]')
    heading?.focus({ preventScroll: true })
    panelRef.current?.scrollIntoView({
      block: 'start',
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth',
    })
  }

  useEffect(() => {
    if (!selectionRequested.current || isPending) return
    selectionRequested.current = false
    focusMobilePanel()
  }, [selectedId, isPending])

  return (
    <div className="mt-8 grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:gap-10 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
      <div className="min-w-0">
        {companies.length === 0 ? empty : (
          <ul className="grid grid-cols-1 gap-4 min-[400px]:grid-cols-2">
            {companies.map(company => {
              const selected = company.id === selectedId
              return (
                <li key={company.id} className="min-w-0">
                  <Link
                    href={company.href}
                    prefetch={false}
                    scroll={false}
                    data-testid={`company-card-${company.id}`}
                    aria-current={selected ? 'true' : undefined}
                    aria-controls="company-jobs-panel"
                    onNavigate={event => {
                      event.preventDefault()
                      selectionRequested.current = true
                      startTransition(() => router.push(company.href, { scroll: false }))
                    }}
                    className={cn(
                      'group relative flex h-full min-h-48 flex-col items-start rounded-card border p-5 text-left transition-[background-color,border-color,box-shadow] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 motion-reduce:transition-none',
                      selected ? 'border-brand bg-brand/5 ring-1 ring-brand/20' : 'border-border bg-card hover:border-brand/40 hover:shadow-float',
                    )}
                  >
                    {selected && <span className="absolute right-3 top-3 inline-flex items-center gap-1 rounded-full bg-brand px-2 py-1 text-[11px] font-medium text-white"><Check className="size-3" aria-hidden="true" />{labels.selected}</span>}
                    {company.hasLogo ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={`/api/logos/${company.id}`} alt="" className="size-12 rounded-control bg-background object-contain" />
                    ) : (
                      <span aria-hidden="true" className="flex size-12 items-center justify-center rounded-control bg-muted text-lg font-semibold text-muted-foreground">{company.name.charAt(0)}</span>
                    )}
                    <h2 className="mt-4 break-words text-sm font-semibold leading-snug">{company.name}</h2>
                    {company.location && <p className="mt-2 flex items-start gap-1 text-xs text-muted-foreground"><MapPin className="mt-px size-3.5 shrink-0" aria-hidden="true" /><span className="break-words">{company.location}</span></p>}
                    <p className="mt-auto pt-4 text-xs font-medium text-brand">{company.jobCount}</p>
                  </Link>
                </li>
              )
            })}
          </ul>
        )}
        {pagination}
      </div>
      <div ref={panelRef} id="company-jobs-panel" data-testid="company-jobs-panel" aria-busy={isPending} className="min-w-0 scroll-mt-24 rounded-card border border-border bg-card lg:sticky lg:top-24 lg:max-h-[calc(100dvh-7rem)] lg:overflow-y-auto">
        <p role="status" aria-live="polite" aria-atomic="true" className={isPending ? 'px-6 pt-5 text-sm text-muted-foreground' : 'sr-only'}>
          {isPending ? labels.loading : selectedName ? labels.selectedFeedback.replace('{name}', selectedName) : ''}
        </p>
        <div className={cn(isPending && 'pointer-events-none opacity-50')} inert={isPending || undefined}>{panel}</div>
      </div>
    </div>
  )
}
