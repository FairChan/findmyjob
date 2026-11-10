'use client'
import { useState, useTransition } from 'react'
import { useTranslations } from 'next-intl'
// 用 Next 原生 router：跳转目标已经带了 /<locale> 前缀；next-intl 的 router 会再加一次，变成 /zh/zh/… 的 404（2026-11-07 E2E 实测）
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { authClient } from '@/lib/auth-client'

interface Props {
  token: string
  locale: string
}

export default function ResetPasswordForm({ token, locale }: Props) {
  const t = useTranslations('resetPassword')
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)

    const data = new FormData(e.currentTarget)
    const newPassword = data.get('newPassword') as string
    const confirmPassword = data.get('confirmPassword') as string

    if (newPassword !== confirmPassword) {
      setError(t('errorPasswordMismatch'))
      return
    }

    startTransition(async () => {
      const { error: authError } = await authClient.resetPassword({
        newPassword,
        token,
      })

      if (authError) {
        if (authError.status === 400) {
          setError(t('errorInvalidToken'))
        } else {
          setError(t('errorFailed'))
        }
        return
      }

      router.push(`/${locale}/login?reset=1`)
    })
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-4">
      <div>
        <label htmlFor="newPassword" className="block text-sm font-medium mb-1">
          {t('newPasswordLabel')} <span aria-hidden="true" className="text-destructive">*</span>
        </label>
        <input
          id="newPassword"
          name="newPassword"
          type="password"
          required
          minLength={8}
          autoComplete="new-password"
          placeholder={t('passwordPlaceholder')}
          onPaste={(e) => e.stopPropagation()}
          className="w-full rounded-control border border-input bg-background px-3 py-2.5 text-sm outline-none transition-colors focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30"
        />
      </div>

      <div>
        <label htmlFor="confirmPassword" className="block text-sm font-medium mb-1">
          {t('confirmPasswordLabel')} <span aria-hidden="true" className="text-destructive">*</span>
        </label>
        <input
          id="confirmPassword"
          name="confirmPassword"
          type="password"
          required
          minLength={8}
          autoComplete="new-password"
          placeholder={t('passwordPlaceholder')}
          onPaste={(e) => e.stopPropagation()}
          className="w-full rounded-control border border-input bg-background px-3 py-2.5 text-sm outline-none transition-colors focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30"
        />
      </div>

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}

      <Button type="submit" variant="brand" className="h-11 w-full" disabled={isPending}>
        {isPending ? '...' : t('submit')}
      </Button>
    </form>
  )
}
