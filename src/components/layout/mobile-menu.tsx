'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { Menu, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet'
import { Link } from '@/i18n/navigation'
import type { Locale } from '@/i18n/routing'
import LocaleSwitcher from './locale-switcher'

export default function MobileMenu({ locale }: { locale: Locale }) {
  const [open, setOpen] = useState(false)
  const t = useTranslations('nav')

  return (
    <>
      <Button
        variant="ghost"
        size="icon"
        className="md:hidden"
        aria-label={t('openMenu')}
        onClick={() => setOpen(true)}
      >
        <Menu className="h-5 w-5" />
      </Button>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="right" className="w-72">
          <SheetTitle className="sr-only">FindMYJob</SheetTitle>
          <nav className="mt-8 flex flex-col gap-4">
            <Link href="/" onClick={() => setOpen(false)} className="text-base font-medium">
              {t('home')}
            </Link>
            <Link href="/jobs" onClick={() => setOpen(false)} className="text-base font-medium">
              {t('jobs')}
            </Link>
            <Link href="/companies" onClick={() => setOpen(false)} className="text-base font-medium">
              {t('companies')}
            </Link>
            <div className="mt-4 border-t pt-4">
              <Link
                href="/login"
                onClick={() => setOpen(false)}
                className="block text-base font-medium"
              >
                {t('login')}
              </Link>
              <Link
                href="/register"
                onClick={() => setOpen(false)}
                className="mt-2 block text-base font-medium text-brand"
              >
                {t('register')}
              </Link>
            </div>
            <div className="mt-2">
              <LocaleSwitcher currentLocale={locale} />
            </div>
          </nav>
        </SheetContent>
      </Sheet>
    </>
  )
}
