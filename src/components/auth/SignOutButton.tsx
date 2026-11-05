'use client'
import { useState, useTransition } from 'react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { authClient } from '@/lib/auth-client'
import { useRouter } from '@/i18n/navigation'

export default function SignOutButton() {
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
