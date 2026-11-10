'use client'
import { useState, useCallback, useTransition } from 'react'
import { useTranslations } from 'next-intl'
// 用 Next 原生 router：跳转目标已经带了 /<locale> 前缀；next-intl 的 router 会再加一次，变成 /zh/zh/… 的 404（2026-11-07 E2E 实测）
import { useRouter } from 'next/navigation'
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
  const [twoFactorRequired, setTwoFactorRequired] = useState(false)
  const [useBackupCode, setUseBackupCode] = useState(false)
  const [code, setCode] = useState('')
  const handleToken = useCallback((token: string) => setTurnstileToken(token), [])
  const handleExpire = useCallback(() => setTurnstileToken(''), [])
  const handleTurnstileError = useCallback(() => setError(t('errorTurnstileFailed')), [t])

  async function finishLogin() {
    const result = await getPostLoginRedirect({ locale, redirect })
    router.push(result.ok ? result.data.path : `/${locale}/s`)
  }

  function restartLogin() {
    setTwoFactorRequired(false)
    setUseBackupCode(false)
    setCode('')
    setError(null)
    setTurnstileToken('')
    setTurnstileKey((key) => key + 1)
  }

  async function handleTwoFactorSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    const value = code.trim()
    if (useBackupCode ? !value : !/^\d{6}$/.test(value)) {
      setError(t(useBackupCode ? 'errorBackupCodeRequired' : 'errorTotpFormat'))
      return
    }

    startTransition(async () => {
      try {
        const { error: authError } = useBackupCode
          ? await authClient.twoFactor.verifyBackupCode({ code: value, trustDevice: false })
          : await authClient.twoFactor.verifyTotp({ code: value, trustDevice: false })

        if (authError) {
          if (authError.status === 429 || authError.code === 'ACCOUNT_TEMPORARILY_LOCKED') {
            setError(t('errorRateLimited'))
          } else if (authError.code === 'INVALID_TWO_FACTOR_COOKIE') {
            setError(t('errorTwoFactorExpired'))
          } else {
            setError(t(useBackupCode ? 'errorBackupCodeInvalid' : 'errorTotpInvalid'))
          }
          return
        }

        setCode('')
        await finishLogin()
      } catch {
        setError(t('errorNetwork'))
      }
    })
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)

    const data = new FormData(e.currentTarget)
    const email = (data.get('email') as string).trim()
    const password = data.get('password') as string

    startTransition(async () => {
      try {
        const { data: authData, error: authError } = await authClient.signIn.email({
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

        if (authData && 'twoFactorRedirect' in authData && authData.twoFactorRedirect) {
          setTwoFactorRequired(true)
          return
        }

        await finishLogin()
      } catch {
        // 网络错误时 action 或 fetch 会直接抛出：重置 Turnstile（旧 token 可能已被消耗），给出提示
        setTurnstileKey((k) => k + 1)
        setTurnstileToken('')
        setError(t('errorNetwork'))
      }
    })
  }

  if (twoFactorRequired) {
    return (
      <form onSubmit={handleTwoFactorSubmit} noValidate className="space-y-4" aria-busy={isPending}>
        <div className="space-y-2">
          <h2 className="font-semibold">{t('twoFactorTitle')}</h2>
          <p id="two-factor-description" className="text-sm text-muted-foreground">
            {t(useBackupCode ? 'backupCodeDescription' : 'totpDescription')}
          </p>
        </div>
        <div>
          <label htmlFor="two-factor-code" className="mb-1 block text-sm font-medium">
            {t(useBackupCode ? 'backupCodeLabel' : 'totpLabel')}
          </label>
          <input
            id="two-factor-code"
            name="code"
            type="text"
            inputMode={useBackupCode ? 'text' : 'numeric'}
            autoComplete="one-time-code"
            autoCapitalize="none"
            spellCheck={false}
            maxLength={useBackupCode ? 64 : 6}
            value={code}
            onChange={(e) => setCode(e.target.value)}
            aria-describedby="two-factor-description"
            aria-invalid={!!error}
            required
            disabled={isPending}
            className="w-full rounded-control border border-input bg-background px-3 py-2.5 text-base outline-none transition-colors focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30"
          />
        </div>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <Button type="submit" variant="brand" className="h-11 w-full" disabled={isPending || !code.trim()}>
          {isPending ? t('verifying') : t('verifySubmit')}
        </Button>
        <Button
          type="button"
          variant="outline"
          className="h-auto min-h-10 w-full whitespace-normal"
          disabled={isPending}
          onClick={() => {
            setUseBackupCode((value) => !value)
            setCode('')
            setError(null)
          }}
        >
          {t(useBackupCode ? 'useTotp' : 'useBackupCode')}
        </Button>
        <Button type="button" variant="link" className="w-full" disabled={isPending} onClick={restartLogin}>
          {t('backToPassword')}
        </Button>
      </form>
    )
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
          className="w-full rounded-control border border-input bg-background px-3 py-2.5 text-sm outline-none transition-colors focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30"
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
          className="w-full rounded-control border border-input bg-background px-3 py-2.5 text-sm outline-none transition-colors focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30"
        />
      </div>

      <div className="text-right">
        <Link
          href="/forgot-password"
          className="text-sm text-brand underline underline-offset-4"
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

      <Button type="submit" variant="brand" className="h-11 w-full" disabled={isPending || !turnstileToken}>
        {isPending ? '...' : t('submit')}
      </Button>

      <div className="text-center text-sm text-muted-foreground">
        {t('registerHint')}{' '}
        <Link href="/register/student" className="text-brand underline underline-offset-4">
          {t('registerLink')}
        </Link>
      </div>
    </form>
  )
}
