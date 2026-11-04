import { getTranslations } from 'next-intl/server'

export default async function Footer() {
  const t = await getTranslations('footer')
  const year = new Date().getFullYear()

  return (
    <footer className="border-t bg-muted/40">
      <div className="container mx-auto max-w-5xl px-4 py-8">
        <div className="flex flex-col items-center gap-2 text-center sm:flex-row sm:justify-between sm:text-left">
          <p className="text-sm font-semibold text-brand">FindMYJob</p>
          <p className="text-xs text-muted-foreground">{t('tagline')}</p>
          <p className="text-xs text-muted-foreground">{t('copyright', { year })}</p>
        </div>
      </div>
    </footer>
  )
}
