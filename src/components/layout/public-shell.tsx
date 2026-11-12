import type { ReactNode } from 'react'
import type { Locale } from '@/i18n/routing'
import Footer from './footer'
import Navbar from './navbar'

/** Chrome for pages anyone can open: the marketing nav and the full footer. */
export function PublicShell({ locale, children }: { locale: Locale; children: ReactNode }) {
  return (
    <>
      <Navbar locale={locale} />
      <main id="main-content" className="flex-1">
        {children}
      </main>
      <Footer />
    </>
  )
}
