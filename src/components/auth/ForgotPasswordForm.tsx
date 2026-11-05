'use client'
import { useState, useCallback, useTransition } from 'react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { authClient } from '@/lib/auth-client'
import TurnstileWidget from './TurnstileWidget'

interface Props {
  siteKey: string
}

export default function ForgotPasswordForm({ siteKey }: Props) {
  const t = useTranslations('forgotPassword')
  const [isPending, startTransition] = useTransition()
  const [submitted, setSubmitted] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [turnstileToken, setTurnstileToken] = useState<string>('')
  const handleToken = useCallback((token: string) => setTurnstileToken(token), [])
  const handleExpire = useCallback(() => setTurnstileToken(''), [])

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)

    const data = new FormData(e.currentTarget)
    const email = (data.get('email') as string).trim()

    startTransition(async () => {
      const { error: authError } = await authClient.requestPasswordReset({
        email,
        redirectTo: `${window.location.origin}/reset-password`,
        // @ts-expect-error extra field consumed by hooks.before
        turnstileToken,
      })

      if (authError && authError.status === 429) {
        setError(t('errorRateLimited'))
        return
      }

      // Always show success message regardless of whether email exists (anti-enumeration)
      setSubmitted(true)
    })
  }

  if (submitted) {
    return (
      <div className="text-center space-y-2">
        <p className="text-sm text-muted-foreground">{t('successMessage')}</p>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-4">
      <p className="text-sm text-muted-foreground">{t('description')}</p>

      <div>
        <label htmlFor="email" className="block text-sm font-medium mb-1">
          {t('emailLabel')} <span aria-hidden="true" className="text-destructive">*</span>
        </label>
        <input
          id="email"
          name="email"
          type="email"
          required
          autoComplete="email"
          placeholder={t('emailPlaceholder')}
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
        />
      </div>

      <TurnstileWidget siteKey={siteKey} action="forgot-password" onToken={handleToken} onExpire={handleExpire} />

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}

      <Button type="submit" className="w-full" disabled={isPending}>
        {isPending ? '...' : t('submit')}
      </Button>
    </form>
  )
}
