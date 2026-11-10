'use client'

import { useMemo, useState } from 'react'

import FlexCarousel from '@/components/ui/flex-carousel/FlexCarousel'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Link } from '@/i18n/navigation'

export interface ShowcaseCompany {
  id: string
  name: string
  /** Same-origin logo URL, or null when the company has not uploaded one. */
  logoSrc: string | null
  description: string | null
  jobCount: number
}

interface CompanyShowcaseProps {
  companies: ShowcaseCompany[]
  labels: {
    region: string
    hint: string
    /** e.g. "{count} open positions"; `{count}` is replaced. */
    jobs: string
    noDescription: string
    viewCompany: string
    close: string
  }
}

const HUES = [210, 146, 30, 262, 340, 190]

/** A tinted tile with the company's initial, for companies without a logo. */
function initialTile(name: string, index: number) {
  const hue = HUES[index % HUES.length]
  const initial = (Array.from(name.trim())[0] ?? '?')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="600">` +
    `<rect width="600" height="600" fill="hsl(${hue} 60% 92%)"/>` +
    `<text x="50%" y="54%" dominant-baseline="middle" text-anchor="middle" font-family="system-ui,sans-serif" ` +
    `font-size="260" font-weight="600" fill="hsl(${hue} 55% 30%)">${initial}</text></svg>`
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
}

/**
 * The partner companies as a flexing image row. Selecting the centred company opens its
 * details. Decoration over the plain list below it, which stays the accessible way in.
 */
export function CompanyShowcase({ companies, labels }: CompanyShowcaseProps) {
  const [selected, setSelected] = useState<ShowcaseCompany | null>(null)
  const items = useMemo(
    () =>
      companies.map((company, index) => ({
        src: company.logoSrc ?? initialTile(company.name, index),
        alt: company.name,
        title: company.name,
        subtitle: labels.jobs.replace('{count}', String(company.jobCount)),
      })),
    [companies, labels.jobs],
  )

  return (
    <div data-testid="company-showcase">
      <div className="relative h-[24rem] overflow-hidden rounded-tile bg-muted sm:h-[28rem]">
        <FlexCarousel
          items={items}
          ariaLabel={labels.region}
          preset="liquid"
          intro="rise"
          fit="square"
          radius={18}
          cardHeight={0.46}
          gap={14}
          squeeze={0.2}
          focusOnClick={false}
          captureWheel={false}
          autoplay
          interval={4}
          captions
          onSelect={(index) => setSelected(companies[index] ?? null)}
        />
      </div>
      <p className="mt-3 text-center text-xs text-muted-foreground">{labels.hint}</p>

      <Dialog open={selected !== null} onOpenChange={(open) => !open && setSelected(null)}>
        <DialogContent closeLabel={labels.close} className="w-[calc(100%_-_2rem)] rounded-card sm:max-w-md">
          {selected && (
            <>
              <DialogHeader>
                <DialogTitle>{selected.name}</DialogTitle>
                <DialogDescription>{labels.jobs.replace('{count}', String(selected.jobCount))}</DialogDescription>
              </DialogHeader>
              <p className="max-h-60 overflow-y-auto whitespace-pre-wrap text-sm text-foreground/80">
                {selected.description?.trim() || labels.noDescription}
              </p>
              <Button asChild variant="brand" className="mt-2 w-full">
                <Link href={`/companies/${selected.id}`} prefetch={false}>
                  {labels.viewCompany}
                </Link>
              </Button>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
