'use client'
import { useState, useTransition } from 'react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { authClient } from '@/lib/auth-client'

export default function ChangePasswordForm() {
  const t = useTranslations('settings')
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    setSuccess(false)

    const data = new FormData(e.currentTarget)
    const currentPassword = data.get('currentPassword') as string
    const newPassword = data.get('newPassword') as string
    const confirmPassword = data.get('confirmPassword') as string

    if (newPassword !== confirmPassword) {
      setError(t('errorPasswordMismatch'))
      return
    }

    startTransition(async () => {
      const { error: authError } = await authClient.changePassword({
        currentPassword,
        newPassword,
        revokeOtherSessions: true,
      })

      if (authError) {
        if (authError.status === 400) {
          setError(t('errorCurrentPasswordWrong'))
        } else {
          setError(t('errorChangeFailed'))
        }
        return
      }

      setSuccess(true)
      ;(e.target as HTMLFormElement).reset()
    })
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-4">
      <div>
        <label htmlFor="currentPassword" className="block text-sm font-medium mb-1">
          {t('currentPasswordLabel')} <span aria-hidden="true" className="text-destructive">*</span>
        </label>
        <input
          id="currentPassword"
          name="currentPassword"
          type="password"
          required
          autoComplete="current-password"
          onPaste={(e) => e.stopPropagation()}
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
        />
      </div>

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
          onPaste={(e) => e.stopPropagation()}
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
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
          onPaste={(e) => e.stopPropagation()}
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
        />
      </div>

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {success && (
        <p role="status" className="text-sm text-green-600">
          {t('passwordChangeSuccess')}
        </p>
      )}

      <Button type="submit" disabled={isPending}>
        {isPending ? '...' : t('changePasswordSubmit')}
      </Button>
    </form>
  )
}
