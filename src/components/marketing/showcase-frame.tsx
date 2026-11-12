import type { ReactNode } from 'react'
import { ArrowUpRight, ArrowRight } from 'lucide-react'
import { Link } from '@/i18n/navigation'
import { Button } from '@/components/ui/button'

export function CompanyMark({ id, name, hasLogo, large = false }: { id: string; name: string; hasLogo: boolean; large?: boolean }) {
  const className = `${large ? 'size-20 sm:size-24 text-3xl' : 'size-12 text-xl'} flex shrink-0 items-center justify-center rounded-control border border-border bg-card font-semibold text-brand`
  return hasLogo
    // Company logos are served by the existing same-origin, verified-company endpoint.
    // eslint-disable-next-line @next/next/no-img-element
    ? <img src={`/api/logos/${id}`} alt={name} className={`${className} object-contain p-2`} />
    : <span aria-hidden="true" className={className}>{Array.from(name.trim())[0] || '?'}</span>
}

export function ShowcaseFrame({ title, description, eyebrow, cta, href, note, collectionTitle, children, visual }: {
  title: string; description: string; eyebrow: string; cta: string; href: string;
  note: string; collectionTitle: string; children: ReactNode; visual: ReactNode;
}) {
  return <div className="page-shell pb-16 pt-6 sm:pt-10" data-testid="public-showcase">
    <section className="grid overflow-hidden rounded-tile border border-border bg-muted lg:grid-cols-[1.25fr_1fr]">
      <div className="min-w-0 px-6 py-10 sm:p-10 lg:p-14">
        <p className="text-sm font-semibold text-brand">{eyebrow}</p>
        <h1 className="mt-5 max-w-2xl break-words text-headline sm:text-display">{title}</h1>
        <p className="mt-6 max-w-xl text-base leading-relaxed text-muted-foreground sm:text-lead">{description}</p>
        <Button asChild variant="brand" size="lg" className="mt-8 h-auto min-h-12 max-w-full whitespace-normal py-3 text-center">
          <Link href={href} prefetch={false}>{cta}<ArrowRight className="shrink-0" aria-hidden="true" /></Link>
        </Button>
        <p className="mt-4 text-sm text-muted-foreground">{note}</p>
      </div>
      <div className="flex min-w-0 items-center justify-center border-t border-border bg-brand-muted px-6 py-10 sm:p-10 lg:border-l lg:border-t-0">{visual}</div>
    </section>
    <section className="mt-12" aria-labelledby="showcase-collection-heading">
      <h2 id="showcase-collection-heading" className="mb-5 text-title">{collectionTitle}</h2>
      {children}
    </section>
    <div className="mt-10 flex flex-col items-start justify-between gap-5 rounded-card bg-muted p-6 sm:flex-row sm:items-center sm:p-8">
      <p className="max-w-lg text-base text-muted-foreground">{note}</p>
      <Button asChild variant="brand" className="h-auto min-h-11 max-w-full whitespace-normal py-3 text-center"><Link href={href} prefetch={false}>{cta}<ArrowUpRight aria-hidden="true" /></Link></Button>
    </div>
  </div>
}

export const showcaseCardClass = 'group min-w-0 rounded-card border border-border bg-card p-6 transition-colors hover:border-brand focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brand motion-reduce:transition-none'
