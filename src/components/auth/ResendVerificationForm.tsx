'use client'
import { useCallback, useState, useTransition } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { authClient } from '@/lib/auth-client'
import { verificationCallbackPath } from '@/lib/email-verification'
import TurnstileWidget from './TurnstileWidget'

interface Props {
  siteKey: string
  defaultEmail?: string
  /** Compact variant shown under a login error. */
  compact?: boolean
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export default function ResendVerificationForm({ siteKey, defaultEmail = '', compact = false }: Props) {
  const t = useTranslations('verifyEmail')
  const locale = useLocale()
  const [email, setEmail] = useState(defaultEmail)
  const [status, setStatus] = useState<'idle' | 'sent' | 'error' | 'rateLimited' | 'invalidEmail'>('idle')
  const [isPending, startTransition] = useTransition()
  const [token, setToken] = useState('')
  const [turnstileKey, setTurnstileKey] = useState(0)
  const handleToken = useCallback((value: string) => setToken(value), [])
  const handleExpire = useCallback(() => setToken(''), [])
  const handleTurnstileError = useCallback(() => setStatus('error'), [])

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const value = email.trim()
    if (!EMAIL_PATTERN.test(value)) {
      setStatus('invalidEmail')
      return
    }
    startTransition(async () => {
      try {
        const { error } = await authClient.sendVerificationEmail({
          email: value,
          callbackURL: verificationCallbackPath(locale),
          // @ts-expect-error extra field consumed by hooks.before (Turnstile)
          turnstileToken: token,
        })
        if (error) setStatus(error.status === 429 ? 'rateLimited' : 'error')
        else setStatus('sent')
      } catch {
        setStatus('error')
      } finally {
        // Turnstile tokens are single-use.
        setToken('')
        setTurnstileKey((key) => key + 1)
      }
    })
  }

  return (
    <form onSubmit={submit} noValidate className={compact ? 'space-y-2' : 'space-y-3 text-left'}>
      {!compact && <p className="text-sm font-medium">{t('resendTitle')}</p>}
      <label htmlFor="resend-email" className="sr-only">
        {t('resendEmailLabel')}
      </label>
      <div className="flex gap-2">
        <input
          id="resend-email"
          type="email"
          autoComplete="email"
          value={email}
          onChange={(e) => {
            setEmail(e.target.value)
            if (status === 'invalidEmail') setStatus('idle')
          }}
          placeholder={t('resendEmailLabel')}
          aria-invalid={status === 'invalidEmail' ? true : undefined}
          className="min-w-0 flex-1 rounded-control border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30"
        />
        <Button type="submit" variant="outline" disabled={isPending || !token} className="h-10 shrink-0">
          {isPending ? t('resending') : t('resendButton')}
        </Button>
      </div>
      <TurnstileWidget
        key={turnstileKey}
        siteKey={siteKey}
        action="send-verification"
        onToken={handleToken}
        onExpire={handleExpire}
        onError={handleTurnstileError}
      />
      <p aria-live="polite" className={status === 'sent' ? 'text-sm text-success' : 'text-sm text-destructive'}>
        {status === 'sent' && t('resendSent')}
        {status === 'error' && t('resendError')}
        {status === 'rateLimited' && t('resendRateLimited')}
        {status === 'invalidEmail' && t('resendInvalidEmail')}
      </p>
    </form>
  )
}
