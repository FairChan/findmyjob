import { getTranslations } from 'next-intl/server'

export type BrandWord = 'right' | 'safe'

/**
 * The brand sentence with this page's adjective: "Finding my ____ Job".
 * A quiet line above a page title, so the idea from the home page carries through.
 */
export async function BrandLine({ word }: { word: BrandWord }) {
  const t = await getTranslations('brandLine')
  return (
    <p className="text-sm font-medium text-muted-foreground">
      {t('lead')}
      <span className="mx-[0.3em] text-brand">{t(`words.${word}`)}</span>
      {t('tail')}
    </p>
  )
}
