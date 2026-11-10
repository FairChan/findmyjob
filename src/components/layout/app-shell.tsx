import type { ReactNode } from 'react'
import { Link } from '@/i18n/navigation'
import type { Locale } from '@/i18n/routing'
import SignOutButton from '@/components/auth/SignOutButton'
import LocaleSwitcher from './locale-switcher'
import { Wordmark } from './wordmark'

interface AppShellProps {
  locale: Locale
  /** Which workspace this is, shown beside the wordmark. */
  area: string
  /** The workspace navigation, rendered as a sidebar on wide screens and a scroller on narrow ones. */
  nav: ReactNode
  /** Links that must be reachable from every page at every width, shown in the top bar. */
  actions?: ReactNode
  children: ReactNode
}

/**
 * Chrome for the signed-in workspaces. Same top bar as the public site, plus a
 * persistent navigation, so the student and employer areas read as one product.
 */
export function AppShell({ locale, area, nav, actions, children }: AppShellProps) {
  return (
    <div className="flex flex-1 flex-col">
      <header className="sticky top-0 z-40 border-b border-border/70 bg-background/80 backdrop-blur-xl backdrop-saturate-150">
        <div className="flex h-12 items-center justify-between gap-3 px-4 lg:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <Link href="/" className="-ml-1 shrink-0 rounded-md px-1 text-[19px]">
              <Wordmark collapse />
            </Link>
            <span className="hidden truncate border-l pl-3 text-xs text-muted-foreground sm:inline">{area}</span>
          </div>
          <div className="flex shrink-0 items-center gap-1 sm:gap-2">
            {actions}
            <LocaleSwitcher currentLocale={locale} />
            <SignOutButton compact />
          </div>
        </div>
      </header>
      <div className="flex-1 lg:grid lg:grid-cols-[15rem_minmax(0,1fr)]">
        {/* Not an <aside>: pages inside own that landmark for their filters. */}
        <div className="border-b lg:border-b-0 lg:border-r">
          <div className="lg:sticky lg:top-12 lg:max-h-[calc(100dvh-3rem)] lg:overflow-y-auto">
            {nav}
          </div>
        </div>
        <main id="main-content" className="min-w-0">
          {children}
        </main>
      </div>
    </div>
  )
}
