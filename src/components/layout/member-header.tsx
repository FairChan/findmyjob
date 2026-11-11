'use client'

import { useState, useTransition } from 'react'
import * as Dropdown from '@radix-ui/react-dropdown-menu'
import { ChevronDown, LogOut, Menu, UserRound } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { Link, usePathname, useRouter } from '@/i18n/navigation'
import type { Locale } from '@/i18n/routing'
import { authClient } from '@/lib/auth-client'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from '@/components/ui/sheet'
import LocaleSwitcher from './locale-switcher'
import { Wordmark } from './wordmark'

export interface MemberLink {
  href: string
  label: string
  count?: number
}

interface MemberHeaderProps {
  locale: Locale
  home: string
  name: string
  image: string | null
  navigationLabel: string
  links: MemberLink[]
  accountLinks: MemberLink[]
}

const MENU_ITEM = 'flex min-h-11 cursor-pointer items-center gap-3 rounded-control px-3 py-2 text-sm outline-none focus:bg-muted data-[highlighted]:bg-muted'

export function MemberHeader({ locale, home, name, image, navigationLabel, links, accountLinks }: MemberHeaderProps) {
  const t = useTranslations('memberNav')
  const settings = useTranslations('settings')
  const pathname = usePathname()
  const router = useRouter()
  const [mobileOpen, setMobileOpen] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [imageFailed, setImageFailed] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  const signOut = () => {
    setError(null)
    startTransition(async () => {
      try {
        const result = await authClient.signOut()
        if (result.error) { setError(settings('errorSignOutFailed')); return }
        setMenuOpen(false)
        router.replace('/login')
        router.refresh()
      } catch { setError(settings('errorSignOutFailed')) }
    })
  }

  function navigation(mobile = false) {
    return <nav aria-label={navigationLabel} className={mobile ? 'mt-6 grid gap-1' : 'hidden min-w-0 items-center gap-0.5 xl:flex'}>
      {links.map(link => {
        const active = pathname === link.href || pathname.startsWith(`${link.href}/`)
        return <Link key={link.href} href={link.href} prefetch={false} onClick={() => setMobileOpen(false)}
          aria-current={active ? 'page' : undefined}
          className={cn('flex min-h-11 items-center gap-2 whitespace-nowrap rounded-full px-3 text-sm font-medium transition-colors', active ? 'bg-brand-muted text-brand-muted-foreground' : 'text-muted-foreground hover:bg-muted hover:text-foreground', mobile && 'rounded-control')}>
          {link.label}
          {!!link.count && <span className="inline-flex min-w-5 items-center justify-center rounded-full bg-brand px-1.5 text-xs leading-5 text-brand-foreground">{link.count > 99 ? '99+' : link.count}</span>}
        </Link>
      })}
    </nav>
  }

  return <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
    <header className="sticky top-0 z-40 px-3 pt-3 sm:px-5">
    <div className="mx-auto flex min-h-16 max-w-7xl items-center justify-between gap-3 rounded-[1.5rem] border border-border/70 bg-background/95 px-3 shadow-[0_8px_30px_rgb(0_0_0/0.06)] backdrop-blur-xl sm:px-5">
      <Link href={home} prefetch={false} aria-label="FindMYJob" className="inline-flex shrink-0 rounded-lg text-[19px]"><Wordmark /></Link>
      {navigation()}
      <div className="flex shrink-0 items-center gap-1 sm:gap-2">
        <div className="hidden sm:block"><LocaleSwitcher currentLocale={locale} /></div>
        <Dropdown.Root open={menuOpen} onOpenChange={setMenuOpen}>
          <Dropdown.Trigger asChild>
            <button type="button" aria-label={t('accountMenu')} className="flex min-h-11 items-center gap-1.5 rounded-full p-1 outline-none focus-visible:ring-2 focus-visible:ring-ring">
              <span className="flex size-9 overflow-hidden rounded-full bg-brand-muted text-brand-muted-foreground items-center justify-center text-sm font-semibold">
                {image && !imageFailed ? (
                  // eslint-disable-next-line @next/next/no-img-element -- User avatars may be external; send no referrer and fall back on failure.
                  <img src={image} alt="" referrerPolicy="no-referrer" onError={() => setImageFailed(true)} className="size-full object-cover" />
                ) : name.trim() ? name.trim().slice(0, 1).toUpperCase() : <UserRound aria-hidden="true" className="size-5" />}
              </span>
              <ChevronDown aria-hidden="true" className="hidden size-3.5 text-muted-foreground sm:block" />
            </button>
          </Dropdown.Trigger>
          <Dropdown.Portal>
            <Dropdown.Content align="end" sideOffset={10} collisionPadding={12} className="z-50 w-64 max-w-[calc(100vw-1.5rem)] max-h-[var(--radix-dropdown-menu-content-available-height)] overflow-y-auto rounded-card border bg-popover p-2 text-popover-foreground shadow-float">
              <Dropdown.Label className="truncate px-3 py-3 text-sm font-semibold">{name || t('accountMenu')}</Dropdown.Label>
              <Dropdown.Separator className="mb-1 h-px bg-border" />
              {accountLinks.map(link => <Dropdown.Item key={link.href} asChild><Link href={link.href} prefetch={false} className={MENU_ITEM}>{link.label}</Link></Dropdown.Item>)}
              <Dropdown.Separator className="my-1 h-px bg-border" />
              <Dropdown.Item disabled={pending} onSelect={event => { event.preventDefault(); signOut() }} className={cn(MENU_ITEM, 'data-[disabled]:opacity-50')}>
                <LogOut aria-hidden="true" className="size-4" />{settings('signOut')}
              </Dropdown.Item>
              {error && <p role="alert" className="px-3 py-2 text-sm text-destructive">{error}</p>}
            </Dropdown.Content>
          </Dropdown.Portal>
        </Dropdown.Root>
        <SheetTrigger asChild>
          <Button variant="ghost" size="icon" aria-label={t('openNavigation')} className="xl:hidden"><Menu aria-hidden="true" /></Button>
        </SheetTrigger>
      </div>
    </div>
      <SheetContent side="right" className="w-80 max-w-[calc(100vw-1rem)] overflow-y-auto" aria-describedby={undefined}>
        <SheetTitle>{navigationLabel}</SheetTitle>
        {navigation(true)}
        <div className="mt-6 border-t pt-5"><LocaleSwitcher currentLocale={locale} /></div>
      </SheetContent>
    </header>
  </Sheet>
}
