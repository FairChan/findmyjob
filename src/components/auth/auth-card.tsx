import type { ReactNode } from 'react'
import Image from 'next/image'
import { getTranslations } from 'next-intl/server'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

interface AuthCardProps {
  title: ReactNode
  description?: ReactNode
  /** Show the "continue with…" buttons above the form. */
  social?: boolean
  /** `lg` for steps with more to read, such as two-factor setup. */
  size?: 'md' | 'lg'
  contentClassName?: string
  children: ReactNode
}

/**
 * The card every sign-in, sign-up and recovery step sits in: brand mark, title, optional
 * provider buttons, then the step's own form. Layout follows the shadcn "sign-in-1" block.
 */
export async function AuthCard({
  title,
  description,
  social = false,
  size = 'md',
  contentClassName,
  children,
}: AuthCardProps) {
  return (
    <div className={cn('page-shell py-10 md:py-16', size === 'lg' ? 'max-w-lg' : 'max-w-md')}>
      <div className="auth-enter rounded-tile bg-card p-6 shadow-float sm:p-8">
        <header className="text-center">
          <Image
            src="/images/brand/findmyjob-mark.svg"
            alt=""
            aria-hidden="true"
            width={440}
            height={408}
            unoptimized
            className="mx-auto h-12 w-auto"
          />
          <h1 className="mt-4 text-title">{title}</h1>
          {description && <p className="mt-1.5 text-sm text-muted-foreground text-pretty">{description}</p>}
        </header>
        {social && <SocialSignIn />}
        <div className={cn('mt-6', contentClassName)}>{children}</div>
      </div>
    </div>
  )
}

/**
 * Provider buttons. Sign-in with Google and Microsoft is not connected yet, so the buttons
 * are shown disabled with a "coming soon" tag rather than hidden.
 */
async function SocialSignIn() {
  const t = await getTranslations('authCard')
  return (
    <>
      <div className="mt-6 grid gap-2">
        <Button type="button" variant="secondary" disabled className="h-11 w-full justify-between px-4">
          <span className="inline-flex items-center gap-2.5">
            <GoogleMark />
            {t('google')}
          </span>
          <Badge tone="plain">{t('soon')}</Badge>
        </Button>
        <Button type="button" variant="secondary" disabled className="h-11 w-full justify-between px-4">
          <span className="inline-flex items-center gap-2.5">
            <MicrosoftMark />
            {t('microsoft')}
          </span>
          <Badge tone="plain">{t('soon')}</Badge>
        </Button>
      </div>
      <div className="relative mt-6" role="presentation">
        <div className="absolute inset-0 flex items-center">
          <span className="w-full border-t" />
        </div>
        <div className="relative flex justify-center text-xs">
          <span className="bg-card px-3 text-muted-foreground">{t('or')}</span>
        </div>
      </div>
    </>
  )
}

function GoogleMark() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="size-4">
      <path fill="#4285F4" d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.5h6.5a5.5 5.5 0 0 1-2.4 3.6v3h3.9c2.3-2.1 3.5-5.2 3.5-8.8Z" />
      <path fill="#34A853" d="M12 24c3.2 0 6-1.1 8-2.9l-3.9-3c-1.1.7-2.5 1.2-4.1 1.2-3.1 0-5.8-2.1-6.7-5H1.3v3.1A12 12 0 0 0 12 24Z" />
      <path fill="#FBBC05" d="M5.3 14.3a7.2 7.2 0 0 1 0-4.6V6.6H1.3a12 12 0 0 0 0 10.8l4-3.1Z" />
      <path fill="#EA4335" d="M12 4.8c1.8 0 3.3.6 4.6 1.8l3.4-3.4A12 12 0 0 0 1.3 6.6l4 3.1c.9-2.8 3.6-4.9 6.7-4.9Z" />
    </svg>
  )
}

function MicrosoftMark() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="size-4">
      <path fill="#F25022" d="M1 1h10.5v10.5H1z" />
      <path fill="#7FBA00" d="M12.5 1H23v10.5H12.5z" />
      <path fill="#00A4EF" d="M1 12.5h10.5V23H1z" />
      <path fill="#FFB900" d="M12.5 12.5H23V23H12.5z" />
    </svg>
  )
}
