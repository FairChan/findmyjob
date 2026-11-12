import Image from 'next/image'
import { getTranslations } from 'next-intl/server'
import { Link } from '@/i18n/navigation'
import { Wordmark } from './wordmark'

const MAIN_LINK = 'inline-flex min-h-6 items-center text-sm text-foreground underline-offset-4 hover:underline'
const LEGAL_LINK =
  'inline-flex min-h-6 items-center text-sm text-muted-foreground underline-offset-4 hover:underline'

export default async function Footer() {
  const t = await getTranslations('footer')
  const nav = await getTranslations('nav')
  const year = new Date().getFullYear()

  return (
    <footer className="relative isolate overflow-hidden border-t bg-muted pb-8 pt-16 lg:pt-24">
      {/* The brand mark, enlarged, sits behind the footer like a shadow cast on the floor. */}
      <Image
        src="/images/brand/findmyjob-mark.svg"
        alt=""
        aria-hidden="true"
        width={440}
        height={408}
        unoptimized
        className="pointer-events-none absolute -bottom-[38%] left-1/2 -z-10 h-[150%] w-auto max-w-none -translate-x-1/2 select-none opacity-[0.055] blur-[1px] md:left-auto md:right-[-4%] md:translate-x-0"
      />
      <div className="page-shell">
        <div className="md:flex md:items-start md:justify-between">
          <div className="max-w-xs">
            <p className="text-xl">
              <Wordmark />
            </p>
            <p className="mt-2 text-sm text-muted-foreground">{t('tagline')}</p>
          </div>
        </div>
        <nav aria-label="footer" className="mt-10 border-t pt-8 lg:grid lg:grid-cols-10">
          <ul className="-mx-2 -my-1 flex list-none flex-wrap lg:col-[4/11] lg:justify-end">
            <li className="mx-2 my-1 shrink-0">
              <Link href="/for-employers" className={MAIN_LINK}>
                {t('forEmployers')}
              </Link>
            </li>
            <li className="mx-2 my-1 shrink-0">
              <Link href="/partners" className={MAIN_LINK}>
                {t('partners')}
              </Link>
            </li>
            <li className="mx-2 my-1 shrink-0">
              <Link href="/safety" className={MAIN_LINK}>
                {t('safety')}
              </Link>
            </li>
            <li className="mx-2 my-1 shrink-0">
              <Link href="/pricing" className={MAIN_LINK}>
                {nav('pricing')}
              </Link>
            </li>
          </ul>
          <ul className="-mx-3 -my-1 mt-5 flex list-none flex-wrap lg:col-[4/11] lg:mt-2 lg:justify-end">
            <li className="mx-3 my-1 shrink-0">
              <Link href="/legal/privacy" className={LEGAL_LINK}>
                {t('privacy')}
              </Link>
            </li>
            <li className="mx-3 my-1 shrink-0">
              <Link href="/legal/terms" className={LEGAL_LINK}>
                {t('terms')}
              </Link>
            </li>
          </ul>
          <p className="mt-6 text-sm leading-6 text-muted-foreground lg:col-[1/4] lg:row-[1/3] lg:mt-0">
            {t('copyright', { year })}
          </p>
        </nav>
      </div>
    </footer>
  )
}
