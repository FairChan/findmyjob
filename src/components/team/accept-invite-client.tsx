'use client'
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { acceptInviteAction } from '@/server/actions/team'

interface Props {
  token: string
  companyName: string
  role: 'ADMIN' | 'RECRUITER'
  locale: string
  t: {
    companyLabel: string
    roleLabel: string
    roleAdmin: string
    roleRecruiter: string
    acceptButton: string
    successMessage: string
    errorForbidden: string
    errorAlreadyUsed: string
    errorExpired: string
    errorUnknown: string
  }
}

export default function AcceptInviteClient({ token, companyName, role, locale, t }: Props) {
  const [error, setError] = useState('')
  const [accepted, setAccepted] = useState(false)
  const [isPending, startTransition] = useTransition()
  const router = useRouter()

  function mapError(code: string): string {
    if (code === 'FORBIDDEN') return t.errorForbidden
    if (code === 'NOT_FOUND') return t.errorExpired
    if (code === 'VALIDATION_ERROR') return t.errorAlreadyUsed
    return t.errorUnknown
  }

  function handleAccept() {
    setError('')
    startTransition(async () => {
      const res = await acceptInviteAction({ token })
      if (res.ok) {
        setAccepted(true)
        setTimeout(() => router.push(`/${locale}/e`), 2000)
      } else {
        setError(mapError(res.code))
      }
    })
  }

  if (accepted) {
    return (
      <div className="rounded-lg border border-green-200 bg-green-50 p-4">
        <p className="text-sm text-green-700">{t.successMessage}</p>
      </div>
    )
  }

  return (
    <div className="rounded-lg border p-6">
      <div className="mb-4">
        <p className="text-sm text-muted-foreground">{t.companyLabel}</p>
        <p className="font-medium">{companyName}</p>
      </div>
      <div className="mb-6">
        <p className="text-sm text-muted-foreground">{t.roleLabel}</p>
        <p className="font-medium">{role === 'ADMIN' ? t.roleAdmin : t.roleRecruiter}</p>
      </div>
      <button
        onClick={handleAccept}
        disabled={isPending}
        className="w-full rounded bg-brand px-4 py-2 text-sm text-white hover:bg-brand-hover disabled:opacity-50"
      >
        {t.acceptButton}
      </button>
      {error && (
        <p className="mt-3 text-sm text-destructive">{error}</p>
      )}
    </div>
  )
}
