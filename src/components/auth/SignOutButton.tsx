'use client'
import { useState, useTransition } from 'react'
import { useTranslations } from 'next-intl'
import { LogOut } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { authClient } from '@/lib/auth-client'
import { useRouter } from '@/i18n/navigation'

interface SignOutButtonProps {
  /** Top-bar form: a quiet button, with any error shown as a small popover beneath it. */
  compact?: boolean
}

export default function SignOutButton({ compact = false }: SignOutButtonProps) {
  const t = useTranslations('settings')
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  function handleClick() {
    setError(null)
    startTransition(async () => {
      // 服务端撤销会话并清 cookie；失败时留在本页，不假装已退出
      const { error: authError } = await authClient.signOut()
      if (authError) {
        setError(t('errorSignOutFailed'))
        return
      }
      router.replace('/login')
      router.refresh()
    })
  }

  if (compact) {
    return (
      <div className="relative">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={handleClick}
          disabled={isPending}
          className="h-8 px-2 text-[13px] text-foreground/80 sm:px-3"
        >
          <LogOut aria-hidden="true" />
          <span className="sr-only sm:not-sr-only">{t('signOut')}</span>
        </Button>
        {error && (
          <p
            role="alert"
            className="absolute right-0 top-full z-50 mt-1 whitespace-nowrap rounded-control bg-destructive-muted px-3 py-1.5 text-xs text-destructive"
          >
            {error}
          </p>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-2">
      <Button type="button" variant="outline" onClick={handleClick} disabled={isPending}>
        {t('signOut')}
      </Button>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  )
}
