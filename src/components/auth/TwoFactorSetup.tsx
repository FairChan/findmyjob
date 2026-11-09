'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { authClient } from '@/lib/auth-client'

interface Props {
  locale: string
  alreadyEnabled: boolean
}

type SetupDetails = { secret: string; backupCodes: string[] }

export default function TwoFactorSetup({ locale, alreadyEnabled }: Props) {
  const t = useTranslations('twoFactorSetup')
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [setup, setSetup] = useState<SetupDetails | null>(null)
  const [code, setCode] = useState('')
  const [savedBackupCodes, setSavedBackupCodes] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copyStatus, setCopyStatus] = useState('')
  const [requiresLogin, setRequiresLogin] = useState(false)
  const [completed, setCompleted] = useState(false)
  const loginHref = `/${locale}/login?redirect=${encodeURIComponent(`/${locale}/admin`)}`

  function showAuthError(authError: { status?: number; code?: string }, verifying: boolean) {
    if (authError.status === 429 || authError.code === 'ACCOUNT_TEMPORARILY_LOCKED') {
      setError(t('errorRateLimited'))
    } else if (authError.code === 'INVALID_PASSWORD') {
      setError(t('errorPassword'))
    } else if (authError.code === 'INVALID_CODE') {
      setError(t('errorCodeInvalid'))
    } else if (
      authError.code === 'UNAUTHORIZED' ||
      authError.code === 'ADMIN_SESSION_EXPIRED' ||
      authError.code === 'INVALID_TWO_FACTOR_COOKIE' ||
      authError.code === 'SESSION_NOT_FRESH' ||
      authError.code === 'FRESH_SESSION_REQUIRED' ||
      authError.code === 'TOTP_ALREADY_ENABLED'
    ) {
      setError(t('errorSessionExpired'))
      setRequiresLogin(true)
    } else {
      setError(t(verifying ? 'errorCodeInvalid' : 'errorEnableFailed'))
    }
  }

  async function handleEnable(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    const form = e.currentTarget
    const password = String(new FormData(form).get('password') ?? '')
    if (!password) {
      setError(t('errorPasswordRequired'))
      return
    }

    startTransition(async () => {
      try {
        const { data, error: authError } = await authClient.twoFactor.enable({ password, method: 'totp' })
        if (authError) {
          showAuthError(authError, false)
          return
        }
        if (!data || data.method !== 'totp') {
          setError(t('errorEnableFailed'))
          return
        }

        const secret = new URL(data.totpURI).searchParams.get('secret')
        if (!secret || !data.backupCodes.length) {
          setError(t('errorEnableFailed'))
          return
        }
        form.reset()
        setSetup({ secret, backupCodes: data.backupCodes })
      } catch {
        setError(t('errorNetwork'))
      }
    })
  }

  async function handleVerify(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    if (!/^\d{6}$/.test(code.trim())) {
      setError(t('errorCodeFormat'))
      return
    }
    if (!savedBackupCodes) {
      setError(t('errorBackupCodesNotSaved'))
      return
    }

    startTransition(async () => {
      try {
        const { error: authError } = await authClient.twoFactor.verifyTotp({ code: code.trim(), trustDevice: false })
        if (authError) {
          showAuthError(authError, true)
          return
        }
        setSetup(null)
        setCode('')
        setCompleted(true)
        router.replace(`/${locale}/admin`)
        router.refresh()
      } catch {
        setError(t('errorNetwork'))
      }
    })
  }

  async function copyValue(value: string) {
    setCopyStatus('')
    try {
      await navigator.clipboard.writeText(value)
      setCopyStatus(t('copied'))
    } catch {
      setCopyStatus(t('copyFailed'))
    }
  }

  if (alreadyEnabled) {
    return (
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">{t('alreadyEnabledDescription')}</p>
        <Button asChild className="w-full bg-brand text-brand-foreground hover:bg-brand/90">
          <Link href={loginHref} prefetch={false}>{t('loginAgain')}</Link>
        </Button>
      </div>
    )
  }

  if (completed) {
    return <p role="status" className="text-sm">{t('completed')}</p>
  }

  return (
    <div className="space-y-6" aria-busy={isPending}>
      <p className="text-sm text-muted-foreground">{t('description')}</p>
      {!setup ? (
        <form onSubmit={handleEnable} noValidate className="space-y-4">
          <div>
            <label htmlFor="setup-password" className="mb-1 block text-sm font-medium">{t('passwordLabel')}</label>
            <input
              id="setup-password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
              disabled={isPending || requiresLogin}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-base focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
          <Button type="submit" className="h-auto min-h-10 w-full whitespace-normal bg-brand text-brand-foreground hover:bg-brand/90" disabled={isPending || requiresLogin}>
            {isPending ? t('generating') : t('enableSubmit')}
          </Button>
        </form>
      ) : (
        <div className="space-y-6">
          <section className="space-y-3" aria-labelledby="setup-app-title">
            <h2 id="setup-app-title" className="font-semibold">{t('appTitle')}</h2>
            <p className="text-sm text-muted-foreground">{t('appDescription')}</p>
            <div>
              <label htmlFor="two-factor-secret" className="mb-1 block text-sm font-medium">{t('secretLabel')}</label>
              <input
                id="two-factor-secret"
                type="text"
                readOnly
                value={setup.secret}
                autoComplete="off"
                spellCheck={false}
                onFocus={(e) => e.currentTarget.select()}
                className="w-full rounded-md border border-input bg-muted px-3 py-2 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
            <Button type="button" variant="outline" className="h-auto min-h-10 whitespace-normal" onClick={() => copyValue(setup.secret)}>
              {t('copySecret')}
            </Button>
          </section>

          <section className="space-y-3 border-t pt-5" aria-labelledby="setup-backup-title">
            <h2 id="setup-backup-title" className="font-semibold">{t('backupTitle')}</h2>
            <p id="backup-codes-description" className="text-sm text-muted-foreground">{t('backupDescription')}</p>
            <ul aria-label={t('backupCodesLabel')} className="grid grid-cols-1 gap-2 rounded-md border bg-muted p-3 min-[360px]:grid-cols-2">
              {setup.backupCodes.map((backupCode) => (
                <li key={backupCode} className="break-all font-mono text-sm">{backupCode}</li>
              ))}
            </ul>
            <Button type="button" variant="outline" className="h-auto min-h-10 whitespace-normal" onClick={() => copyValue(setup.backupCodes.join('\n'))}>
              {t('copyBackupCodes')}
            </Button>
            <p role="status" className="text-sm text-muted-foreground">{copyStatus}</p>
          </section>

          <form onSubmit={handleVerify} noValidate className="space-y-4 border-t pt-5">
            <label htmlFor="backup-codes-saved" className="flex min-h-10 cursor-pointer items-start gap-3 text-sm">
              <input
                id="backup-codes-saved"
                type="checkbox"
                checked={savedBackupCodes}
                onChange={(e) => setSavedBackupCodes(e.target.checked)}
                aria-describedby="backup-codes-description"
                disabled={isPending || requiresLogin}
                className="mt-0.5 h-5 w-5 shrink-0 accent-brand focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
              />
              <span>{t('savedBackupCodes')}</span>
            </label>
            <div>
              <label htmlFor="setup-code" className="mb-1 block text-sm font-medium">{t('codeLabel')}</label>
              <input
                id="setup-code"
                name="code"
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                value={code}
                onChange={(e) => setCode(e.target.value)}
                required
                disabled={isPending || requiresLogin}
                aria-invalid={!!error}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-base focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
            <Button type="submit" className="h-auto min-h-10 w-full whitespace-normal bg-brand text-brand-foreground hover:bg-brand/90" disabled={isPending || requiresLogin || !savedBackupCodes || !code.trim()}>
              {isPending ? t('verifying') : t('verifySubmit')}
            </Button>
          </form>
        </div>
      )}
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {requiresLogin && (
        <Link href={loginHref} prefetch={false} className="inline-flex min-h-10 items-center text-sm text-brand underline underline-offset-4">
          {t('loginAgain')}
        </Link>
      )}
    </div>
  )
}
