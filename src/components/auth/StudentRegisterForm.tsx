'use client'
import { useState, useCallback, useTransition } from 'react'
import { useTranslations } from 'next-intl'
import { useRouter } from '@/i18n/navigation'
import { Button } from '@/components/ui/button'
import { registerStudent } from '@/server/actions/register'
import TurnstileWidget from './TurnstileWidget'

interface Props {
  locale: string
  ref?: string
  siteKey: string
}

export default function StudentRegisterForm({ locale, ref: refCode, siteKey }: Props) {
  const t = useTranslations('register')
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [turnstileToken, setTurnstileToken] = useState<string>('')
  // Incrementing key causes TurnstileWidget to remount and issue a fresh token.
  const [turnstileKey, setTurnstileKey] = useState(0)
  const handleToken = useCallback((token: string) => setTurnstileToken(token), [])
  const handleExpire = useCallback(() => setTurnstileToken(''), [])
  const handleTurnstileError = useCallback(() => setError(t('errorTurnstileFailed')), [t])

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)

    const data = new FormData(e.currentTarget)
    const name = (data.get('name') as string).trim()
    const email = (data.get('email') as string).trim()
    const password = data.get('password') as string
    const agreeTerms = data.get('agreeTerms') === 'on'
    const agreePrivacy = data.get('agreePrivacy') === 'on'
    const joinTalentPool = data.get('joinTalentPool') === 'on'

    if (!agreeTerms || !agreePrivacy) {
      setError(t('errorRequired'))
      return
    }

    startTransition(async () => {
      try {
        const result = await registerStudent({
          name,
          email,
          password,
          agreeTerms: true,
          agreePrivacy: true,
          joinTalentPool,
          ref: refCode || undefined,
          turnstileToken,
        })

        if (result.ok) {
          router.push('/register/verify-email')
        } else {
          // Reset Turnstile so the token can be refreshed before the next attempt.
          setTurnstileKey((k) => k + 1)
          setTurnstileToken('')

          if (result.code === 'VALIDATION_ERROR') {
            setError(t('errorRequired'))
          } else if (result.code === 'SIGNUP_CLOSED') {
            setError(t('errorSignupClosed'))
          } else if (result.code === 'REGISTER_FAILED') {
            setError(t('errorRegisterFailed'))
          } else if (result.code === 'TURNSTILE_FAILED') {
            setError(t('errorTurnstileFailed'))
          } else {
            setError(t('errorUnknown'))
          }
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
        <label htmlFor="name" className="block text-sm font-medium mb-1">
          {t('nameLabel')} <span aria-hidden="true" className="text-destructive">*</span>
        </label>
        <input
          id="name"
          name="name"
          type="text"
          required
          autoComplete="name"
          placeholder={t('namePlaceholder')}
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
        />
      </div>

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
          minLength={8}
          autoComplete="new-password"
          placeholder={t('passwordPlaceholder')}
          onPaste={(e) => e.stopPropagation()}
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
        />
      </div>

      <div className="space-y-2">
        <label className="flex items-start gap-2 cursor-pointer">
          <input
            id="agreeTerms"
            name="agreeTerms"
            type="checkbox"
            required
            className="mt-0.5 h-4 w-4 rounded border-input accent-brand"
          />
          <span className="text-sm">{t('agreeTerms')}</span>
        </label>

        <label className="flex items-start gap-2 cursor-pointer">
          <input
            id="agreePrivacy"
            name="agreePrivacy"
            type="checkbox"
            required
            className="mt-0.5 h-4 w-4 rounded border-input accent-brand"
          />
          <span className="text-sm">{t('agreePrivacy')}</span>
        </label>

        <label className="flex items-start gap-2 cursor-pointer">
          <input
            id="joinTalentPool"
            name="joinTalentPool"
            type="checkbox"
            className="mt-0.5 h-4 w-4 rounded border-input accent-brand"
          />
          <span className="text-sm text-muted-foreground">{t('joinTalentPool')}</span>
        </label>
      </div>

      <TurnstileWidget key={turnstileKey} siteKey={siteKey} action="register" onToken={handleToken} onExpire={handleExpire} onError={handleTurnstileError} />

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
        {isPending ? '...' : t('submitStudent')}
      </Button>
    </form>
  )
}
