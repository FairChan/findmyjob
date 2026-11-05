'use client'
import { useState, useCallback, useTransition } from 'react'
import { useTranslations } from 'next-intl'
import { useRouter } from '@/i18n/navigation'
import { Link } from '@/i18n/navigation'
import { Button } from '@/components/ui/button'
import { authClient } from '@/lib/auth-client'
import { getPostLoginRedirect } from '@/server/actions/account'
import TurnstileWidget from './TurnstileWidget'

interface Props {
  locale: string
  redirect?: string
  siteKey: string
}

export default function LoginForm({ locale, redirect, siteKey }: Props) {
  const t = useTranslations('login')
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [turnstileToken, setTurnstileToken] = useState<string>('')
  const [turnstileKey, setTurnstileKey] = useState(0)
  const handleToken = useCallback((token: string) => setTurnstileToken(token), [])
  const handleExpire = useCallback(() => setTurnstileToken(''), [])
  const handleTurnstileError = useCallback(() => setError(t('errorTurnstileFailed')), [t])

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)

    const data = new FormData(e.currentTarget)
    const email = (data.get('email') as string).trim()
    const password = data.get('password') as string

    startTransition(async () => {
      try {
        const { error: authError } = await authClient.signIn.email({
          email,
          password,
          // @ts-expect-error extra field consumed by hooks.before
          turnstileToken,
        })

        if (authError) {
          // Reset Turnstile so a fresh token is issued before the next attempt.
          setTurnstileKey((k) => k + 1)
          setTurnstileToken('')

          if (authError.code === 'EMAIL_NOT_VERIFIED') {
            setError(t('errorEmailNotVerified'))
          } else if (authError.status === 429) {
            setError(t('errorRateLimited'))
          } else if (authError.code === 'TURNSTILE_FAILED') {
            setError(t('errorTurnstileFailed'))
          } else {
            setError(t('errorInvalidCredentials'))
          }
          return
        }

        const result = await getPostLoginRedirect({ locale, redirect })
        if (result.ok) {
          router.push(result.data.path)
        } else {
          router.push(`/${locale}/s`)
        }
      } catch {
        // 网络错误时 action 或 fetch 会直接抛出：重置 Turnstile（旧 token 可能已被消耗），给出提示
        setTurnstileKey((k) => k + 1)
        setTurnstileToken('')
        setError(t('errorNetwork'))
      }
    })
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-4">
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

      <div>
        <label htmlFor="password" className="block text-sm font-medium mb-1">
          {t('passwordLabel')} <span aria-hidden="true" className="text-destructive">*</span>
        </label>
        <input
          id="password"
          name="password"
          type="password"
          required
          autoComplete="current-password"
          placeholder={t('passwordPlaceholder')}
          onPaste={(e) => e.stopPropagation()}
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
        />
      </div>

      <div className="text-right">
        <Link
          href="/forgot-password"
          className="text-sm text-brand underline-offset-4 hover:underline"
        >
          {t('forgotPassword')}
        </Link>
      </div>

      <TurnstileWidget key={turnstileKey} siteKey={siteKey} action="login" onToken={handleToken} onExpire={handleExpire} onError={handleTurnstileError} />

      {!turnstileToken && !isPending && (
        <p className="text-xs text-muted-foreground" aria-live="polite">
          {t('turnstileLoading')}
        </p>
      )}

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}

      <Button type="submit" className="w-full" disabled={isPending || !turnstileToken}>
        {isPending ? '...' : t('submit')}
      </Button>

      <div className="text-center text-sm text-muted-foreground">
        {t('registerHint')}{' '}
        <Link href="/register/student" className="text-brand underline-offset-4 hover:underline">
          {t('registerLink')}
        </Link>
      </div>
    </form>
  )
}
