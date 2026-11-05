'use client'
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { submitReconsentAction } from './actions'

interface ReconsentFormProps {
  locale: string
  messages: {
    reconsentAgree: string
    reconsentSubmit: string
    reconsentRequired: string
    reconsentViewPrivacy: string
    reconsentViewTerms: string
    reconsentSuccess: string
  }
}

export default function ReconsentForm({ locale, messages }: ReconsentFormProps) {
  const router = useRouter()
  const [agreed, setAgreed] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)
  const [isPending, startTransition] = useTransition()

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!agreed) {
      setError(messages.reconsentRequired)
      return
    }
    setError(null)
    startTransition(async () => {
      const result = await submitReconsentAction({ agreed: true })
      if (result.ok) {
        setDone(true)
        // M1-T04 will replace this with a redirect to the original destination.
        setTimeout(() => {
          router.push(`/${locale}`)
        }, 1500)
      } else {
        setError(result.code)
      }
    })
  }

  if (done) {
    return (
      <p className="text-sm text-green-700 dark:text-green-400 font-medium">
        {messages.reconsentSuccess}
      </p>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <div className="flex gap-3">
        <a
          href={`/${locale}/legal/privacy`}
          target="_blank"
          rel="noopener noreferrer"
          className="text-sm text-brand underline underline-offset-4 hover:text-brand/80"
        >
          {messages.reconsentViewPrivacy}
        </a>
        <span className="text-muted-foreground">·</span>
        <a
          href={`/${locale}/legal/terms`}
          target="_blank"
          rel="noopener noreferrer"
          className="text-sm text-brand underline underline-offset-4 hover:text-brand/80"
        >
          {messages.reconsentViewTerms}
        </a>
      </div>

      <label className="flex items-start gap-3 cursor-pointer">
        <input
          type="checkbox"
          checked={agreed}
          onChange={(e) => setAgreed(e.target.checked)}
          className="mt-0.5 h-4 w-4 rounded border-input accent-brand"
          aria-required="true"
        />
        <span className="text-sm text-foreground leading-6">
          {messages.reconsentAgree}
        </span>
      </label>

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={isPending}
        className="inline-flex h-9 items-center justify-center rounded-md bg-brand px-4 text-sm font-semibold text-brand-foreground hover:bg-brand/90 disabled:opacity-50 transition-colors"
      >
        {messages.reconsentSubmit}
      </button>
    </form>
  )
}
