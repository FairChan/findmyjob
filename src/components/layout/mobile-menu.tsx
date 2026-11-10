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
        className="lg:hidden"
        aria-label={t('openMenu')}
        onClick={() => setOpen(true)}
      >
        <Menu className="h-5 w-5" />
      </Button>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="right" className="w-72">
          <SheetTitle className="sr-only">FindMYJob</SheetTitle>
          <nav className="mt-8 flex flex-col gap-1" aria-label={t('primaryNavigation')}>
            <Link href="/jobs" onClick={() => setOpen(false)} className="flex min-h-11 items-center text-title">
              {t('jobs')}
            </Link>
            <Link href="/companies" onClick={() => setOpen(false)} className="flex min-h-11 items-center text-title">
              {t('companies')}
            </Link>
            <Link href="/for-employers" onClick={() => setOpen(false)} className="flex min-h-11 items-center text-title">
              {t('forEmployers')}
            </Link>
            <Link href="/safety" onClick={() => setOpen(false)} className="flex min-h-11 items-center text-title">
              {t('safety')}
            </Link>
            <div className="mt-4 border-t pt-4">
              <Link
                href="/login"
                onClick={() => setOpen(false)}
                className="flex min-h-11 items-center text-body font-medium"
              >
                {t('login')}
              </Link>
              <Link
                href="/register"
                onClick={() => setOpen(false)}
                className="flex min-h-11 items-center text-body font-medium text-brand"
              >
                {t('register')}
              </Link>
            </div>
            <div className="mt-4 self-start">
              <LocaleSwitcher currentLocale={locale} />
            </div>
          </nav>
        </SheetContent>
      </Sheet>
    </>
  )
}
