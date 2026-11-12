'use client'

import { useState, type ReactNode } from 'react'
import { motion, MotionConfig } from 'motion/react'
import { Menu } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet'
import { Link } from '@/i18n/navigation'

export interface Navbar1Link {
  href: string
  label: string
}

interface Navbar1Props {
  /** Wordmark or logo; it is wrapped in a link to the home page. */
  brand: ReactNode
  /** Accessible name of the brand link and of the mobile sheet. */
  brandLabel: string
  links: Navbar1Link[]
  login: Navbar1Link
  cta: Navbar1Link
  /** Language switcher, shown in the pill on desktop and in the sheet on mobile. */
  extra?: ReactNode
  labels: { primaryNavigation: string; openMenu: string }
}

const NAV_LINK =
  'inline-flex min-h-8 items-center rounded-full px-3 text-[13px] font-medium text-foreground/80 transition-colors hover:text-foreground'

/**
 * Floating pill navigation. Layout and motion follow the shadcn "navbar-1" block;
 * colours come from the design tokens and the mobile menu is a Sheet so it keeps
 * focus trapping and Escape handling.
 */
export function Navbar1({ brand, brandLabel, links, login, cta, extra, labels }: Navbar1Props) {
  const [open, setOpen] = useState(false)
  const close = () => setOpen(false)

  return (
    // reducedMotion="user" turns the transform animations off for people who ask the OS for less motion.
    <MotionConfig reducedMotion="user">
      <header className="sticky top-0 z-40 px-4 pt-3">
        <div className="mx-auto flex h-12 w-full max-w-4xl items-center justify-between rounded-full border border-border/70 bg-background/80 px-5 shadow-[0_8px_30px_rgb(0_0_0/0.08)] backdrop-blur-xl backdrop-saturate-150">
          <motion.div
            initial={{ scale: 0.92 }}
            animate={{ scale: 1 }}
            whileHover={{ scale: 1.03 }}
            transition={{ duration: 0.3 }}
          >
            <Link href="/" aria-label={brandLabel} className="-ml-1 inline-flex rounded-full px-1 text-[19px]">
              {brand}
            </Link>
          </motion.div>

          {/* Desktop navigation */}
          <nav className="hidden items-center gap-1 lg:flex" aria-label={labels.primaryNavigation}>
            {links.map((item) => (
              <motion.div key={item.href} whileHover={{ scale: 1.05 }}>
                <Link href={item.href} className={NAV_LINK}>
                  {item.label}
                </Link>
              </motion.div>
            ))}
          </nav>

          <div className="hidden items-center gap-3 lg:flex">
            {extra}
            <Link href={login.href} className={NAV_LINK}>
              {login.label}
            </Link>
            <motion.div whileHover={{ scale: 1.05 }}>
              <Button asChild variant="brand" size="sm" className="h-8 px-4 text-[13px]">
                <Link href={cta.href}>{cta.label}</Link>
              </Button>
            </motion.div>
          </div>

          {/* Mobile menu button */}
          <motion.div whileTap={{ scale: 0.9 }} className="lg:hidden">
            <Button
              variant="ghost"
              size="icon"
              className="-mr-2"
              aria-label={labels.openMenu}
              onClick={() => setOpen(true)}
            >
              <Menu className="h-5 w-5" />
            </Button>
          </motion.div>
        </div>
      </header>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="right" className="w-72">
          <SheetTitle className="sr-only">{brandLabel}</SheetTitle>
          <nav className="mt-8 flex flex-col gap-1" aria-label={labels.primaryNavigation}>
            {links.map((item, i) => (
              <motion.div
                key={item.href}
                initial={{ opacity: 0, x: 20 }}
                animate={open ? { opacity: 1, x: 0 } : undefined}
                transition={{ delay: i * 0.05 + 0.05 }}
              >
                <Link href={item.href} onClick={close} className="flex min-h-11 items-center text-title">
                  {item.label}
                </Link>
              </motion.div>
            ))}
            <div className="mt-4 border-t pt-4">
              <Link href={login.href} onClick={close} className="flex min-h-11 items-center text-body font-medium">
                {login.label}
              </Link>
              <Button asChild variant="brand" className="mt-2 w-full">
                <Link href={cta.href} onClick={close}>
                  {cta.label}
                </Link>
              </Button>
            </div>
            {extra && <div className="mt-4 self-start">{extra}</div>}
          </nav>
        </SheetContent>
      </Sheet>
    </MotionConfig>
  )
}
