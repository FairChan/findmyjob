'use client'
import { useState, useCallback, useTransition } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { useRouter } from '@/i18n/navigation'
import { Button } from '@/components/ui/button'
import { registerEmployer } from '@/server/actions/register'
import TurnstileWidget from './TurnstileWidget'
import RegistrationCoreFields from './RegistrationCoreFields'
import {
  firstInvalidField,
  validateRegistration,
  type RegistrationErrorKey,
  type RegistrationField,
} from './registration-validation'

interface Props {
  siteKey: string
}

export default function EmployerRegisterForm({ siteKey }: Props) {
  const t = useTranslations('register')
  const locale = useLocale()
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<RegistrationField, RegistrationErrorKey>>>({})
  const [turnstileToken, setTurnstileToken] = useState<string>('')
  // Incrementing key causes TurnstileWidget to remount and issue a fresh token.
  const [turnstileKey, setTurnstileKey] = useState(0)
  const handleToken = useCallback((token: string) => setTurnstileToken(token), [])
  const handleExpire = useCallback(() => setTurnstileToken(''), [])
  const handleTurnstileError = useCallback(() => setError(t('errorTurnstileFailed')), [t])
  const clearFieldError = useCallback((field: RegistrationField) => {
    setFieldErrors((current) => (current[field] ? { ...current, [field]: undefined } : current))
  }, [])

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)

    const form = e.currentTarget
    const data = new FormData(form)
    const input = {
      name: ((data.get('name') as string) ?? '').trim(),
      email: ((data.get('email') as string) ?? '').trim(),
      password: (data.get('password') as string) ?? '',
      agreeTerms: data.get('agreeTerms') === 'on',
      agreePrivacy: data.get('agreePrivacy') === 'on',
    }

    const errors = validateRegistration(input)
    setFieldErrors(errors)
    const firstInvalid = firstInvalidField(errors)
    if (firstInvalid) {
      form.querySelector<HTMLElement>(`#${firstInvalid}`)?.focus()
      return
    }

    startTransition(async () => {
      try {
        const result = await registerEmployer({
          name: input.name,
          email: input.email,
          password: input.password,
          agreeTerms: true,
          agreePrivacy: true,
          turnstileToken,
          locale: locale === 'en' ? 'en' : 'zh',
        })

        if (result.ok) {
          router.push('/register/verify-email?role=employer')
        } else {
          // Reset Turnstile so the token can be refreshed before the next attempt.
          setTurnstileKey((k) => k + 1)
          setTurnstileToken('')

          if (result.code === 'VALIDATION_ERROR') {
            setError(t('errorCheckFields'))
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
      <RegistrationCoreFields
        errors={fieldErrors}
        onFieldChange={clearFieldError}
        checkboxClassName="mt-0.5 h-4 w-4 rounded border-input accent-brand"
      />

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

      <Button type="submit" variant="brand" className="h-11 w-full" disabled={isPending || !turnstileToken}>
        {isPending ? t('submitting') : t('submitEmployer')}
      </Button>
    </form>
  )
}
