'use client'
import { useState, useTransition } from 'react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { ContactFields, normalizeContact } from './ContactFields'
import { updateOwnContactAction } from '@/server/actions/contact'
import type { ContactData } from '@/server/services/contact-access'

interface Props {
  initial: ContactData
}

export default function ContactForm({ initial }: Props) {
  const t = useTranslations('contact')
  const [pending, startTransition] = useTransition()
  const [status, setStatus] = useState<'idle' | 'success' | 'error'>('idle')
  const [errorMsg, setErrorMsg] = useState('')

  const [contact, setContact] = useState(initial)

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setStatus('idle')
    startTransition(async () => {
      const res = await updateOwnContactAction(normalizeContact(contact))
      if (res.ok) {
        setStatus('success')
      } else {
        setStatus('error')
        setErrorMsg(res.code ?? 'UNKNOWN_ERROR')
      }
    })
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <p className="rounded-control bg-brand-muted p-4 text-sm text-brand-muted-foreground">
        {t('privacyNotice')}
      </p>

      <Card>
        <ContactFields value={contact} onChange={setContact} disabled={pending} />
      </Card>

      {status === 'success' && (
        <p role="status" className="text-sm text-success">
          {t('saveSuccess')}
        </p>
      )}
      {status === 'error' && (
        <p role="alert" className="text-sm text-destructive">
          {errorMsg === 'VALIDATION_ERROR' ? t('errorValidation') : t('saveError')}
        </p>
      )}

      <Button type="submit" variant="brand" disabled={pending} className="h-11 min-w-28">
        {pending ? t('saving') : t('save')}
      </Button>
    </form>
  )
}
