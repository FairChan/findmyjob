'use client'

import { ArrowUpRight, Pause, Play } from 'lucide-react'
import { useCallback, useMemo, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { Link } from '@/i18n/navigation'
import TeamLanyardRail, { type LanyardMember } from '@/components/ui/team-lanyard-rail'

const profiles = ['lin', 'aisha', 'chen', 'daniel', 'mei', 'arif'] as const

export function HomeRecruiterRail() {
  const t = useTranslations('home.recruiters')
  const locale = useLocale()
  const [autoplay, setAutoplay] = useState(true)
  const stopAutoplay = useCallback(() => setAutoplay(false), [])
  // No public recruiter-presence feed exists yet. Keep preview identities explicit.
  const items = useMemo<LanyardMember[]>(
    () =>
      profiles.map((id, index) => ({
        id,
        name: t(`people.${id}.name`),
        role: t(`people.${id}.role`),
        team: t(`people.${id}.team`),
        bio: t(`people.${id}.bio`),
        tags: [t(`people.${id}.tag`), t('languageTag')],
        image: `/images/recruiters/${id}.jpg`,
        status: t('onlineDemo'),
        tone: ((index % 5) + 1) as LanyardMember['tone'],
        links: [{ label: t('rolesLink'), href: `/${locale}/jobs` }],
      })),
    [locale, t],
  )

  return (
    <div className="bg-muted py-12 md:py-16">
      <div className="mx-auto w-full max-w-7xl sm:px-6">
        <TeamLanyardRail
          items={items}
          data-testid="recruiter-rail"
          aria-label={t('sectionLabel')}
          heading={t('heading')}
          autoplay={autoplay}
          onAutoplayStop={stopAutoplay}
          interval={3500}
          draggable={false}
          labels={{ flip: t('flip'), back: t('back'), show: t('show') }}
          className="sm:rounded-tile"
          action={
            <Link
              href="/jobs"
              prefetch={false}
              className="inline-flex min-h-11 items-center gap-2 rounded-full bg-brand px-6 py-2.5 text-sm font-medium text-white transition-colors hover:bg-brand/90 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brand"
            >
              {t('cta')}
              <ArrowUpRight className="size-4" aria-hidden="true" />
            </Link>
          }
        />
        <div className="mt-3 flex justify-center px-4">
          <button
            type="button"
            onClick={() => setAutoplay((value) => !value)}
            aria-pressed={!autoplay}
            aria-label={autoplay ? t('pause') : t('play')}
            title={autoplay ? t('pause') : t('play')}
            className="inline-flex size-11 items-center justify-center rounded-full text-muted-foreground hover:bg-background focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
          >
            {autoplay ? (
              <Pause className="size-4" aria-hidden="true" />
            ) : (
              <Play className="size-4" aria-hidden="true" />
            )}
          </button>
        </div>
      </div>
    </div>
  )
}
