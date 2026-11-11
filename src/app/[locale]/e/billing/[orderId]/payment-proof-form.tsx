'use client'

import { useId, useRef, useState, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { useAdminActionFeedback } from '@/components/admin/admin-action-feedback'
import { attachBankProofAction } from '@/server/actions/billing'
import { BillingError } from '../billing-error'

export function PaymentProofForm({ orderId, hasProof }: { orderId: string; hasProof: boolean }) {
  const t = useTranslations('billing')
  const id = useId()
  const router = useRouter()
  const feedback = useAdminActionFeedback()
  const fileInput = useRef<HTMLInputElement>(null)
  const inFlight = useRef(false)
  const [file, setFile] = useState<File | null>(null)
  const [uploadedKey, setUploadedKey] = useState<string | null>(null)
  const [attached, setAttached] = useState(hasProof)
  const [pending, setPending] = useState<'upload' | 'attach' | null>(null)
  const [failure, setFailure] = useState({ code: '', operation: 'upload' as 'upload' | 'attach' })

  async function upload() {
    if (inFlight.current) return
    setFailure({ code: '', operation: 'upload' })
    if (!file || file.size === 0 || !['image/png', 'image/jpeg', 'application/pdf'].includes(file.type)) { setFailure({ code: 'INVALID_FILE_TYPE', operation: 'upload' }); return }
    if (file.size > 10 * 1024 * 1024) { setFailure({ code: 'FILE_TOO_LARGE', operation: 'upload' }); return }
    inFlight.current = true
    setPending('upload')
    try {
      const body = new FormData()
      body.set('file', file)
      const response = await fetch('/api/uploads/PAYMENT_PROOF', { method: 'POST', body, credentials: 'same-origin' })
      const result: unknown = await response.json()
      if (response.ok && result && typeof result === 'object' && 'ok' in result && result.ok === true && 'key' in result && typeof result.key === 'string' && result.key.length > 0) {
        setUploadedKey(result.key)
      } else {
        const code = result && typeof result === 'object' && 'code' in result && typeof result.code === 'string' ? result.code : 'UNKNOWN'
        setFailure({ code, operation: 'upload' })
      }
    } catch { setFailure({ code: 'UNKNOWN', operation: 'upload' }) }
    finally { inFlight.current = false; setPending(null) }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (inFlight.current || !uploadedKey) return
    inFlight.current = true
    setPending('attach')
    setFailure({ code: '', operation: 'attach' })
    try {
      const result = await attachBankProofAction({ orderId, proofKey: uploadedKey })
      if (result.ok) {
        feedback.announce(t(attached || hasProof ? 'replaced' : 'attached'))
        setAttached(true)
        setUploadedKey(null)
        setFile(null)
        if (fileInput.current) fileInput.current.value = ''
        router.refresh()
        requestAnimationFrame(feedback.focusFeedback)
      } else setFailure({ code: result.code, operation: 'attach' })
    } catch { setFailure({ code: 'UNKNOWN', operation: 'attach' }) }
    finally { inFlight.current = false; setPending(null) }
  }

  return <form data-testid="payment-proof-form" onSubmit={submit} aria-busy={pending !== null} className="min-w-0 space-y-4 rounded-card border border-border bg-card p-4 sm:p-6">
    <h2 className="font-semibold">{t(attached || hasProof ? 'replaceProof' : 'proof')}</h2>
    <div className="space-y-2">
      <label htmlFor={id + '-file'} className="block text-sm font-medium">{t('proof')}</label>
      <input ref={fileInput} id={id + '-file'} name="file" type="file" accept="image/png,image/jpeg,application/pdf" disabled={pending !== null} aria-describedby={id + '-hint'} onChange={(event) => { setFile(event.target.files?.[0] ?? null); setUploadedKey(null); setFailure({ code: '', operation: 'upload' }) }} className="block w-full min-w-0 rounded-card border border-border p-2 text-base file:mr-3 file:rounded file:border-0 file:bg-muted file:px-3 file:py-2 file:text-sm focus-visible:outline-2 focus-visible:outline-brand" />
      <p id={id + '-hint'} className="text-xs text-muted-foreground">{t('proofHint')}</p>
    </div>
    <p className="text-sm text-muted-foreground">{t(attached || hasProof ? 'replaceProofHint' : 'proofReviewNotice')}</p>
    {uploadedKey && <p role="status" className="text-sm text-success">{t('uploaded')}</p>}
    <BillingError code={failure.code} operation={failure.operation} />
    <div className="flex flex-wrap gap-3"><Button type="button" variant="outline" disabled={pending !== null || !file || !!uploadedKey} onClick={upload} className="h-auto min-h-10 whitespace-normal">{t(pending === 'upload' ? 'uploading' : 'upload')}</Button><Button type="submit" disabled={pending !== null || !uploadedKey} className="h-auto min-h-10 whitespace-normal">{t(pending === 'attach' ? 'submittingProof' : 'submitProof')}</Button></div>
  </form>
}
