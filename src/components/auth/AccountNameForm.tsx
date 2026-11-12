'use client'

import { useState, useTransition } from 'react'
import { useTranslations } from 'next-intl'
import { useRouter } from '@/i18n/navigation'
import { updateAccountNameAction } from '@/server/actions/account'
import { Button } from '@/components/ui/button'
import { FIELD_CLASS } from '@/components/ui/field'

export default function AccountNameForm({ name, email }: { name: string; email: string }) {
  const t = useTranslations('memberNav')
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [status, setStatus] = useState<'saved' | 'error' | null>(null)
  return <form className="space-y-4" onSubmit={event => {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    setStatus(null)
    startTransition(async () => {
      try {
        const result = await updateAccountNameAction({ name: String(data.get('name') ?? '') })
        setStatus(result.ok ? 'saved' : 'error')
        if (result.ok) router.refresh()
      } catch { setStatus('error') }
    })
  }}>
    <div><label htmlFor="account-name" className="mb-2 block text-sm font-medium">{t('name')}</label><input id="account-name" name="name" defaultValue={name} maxLength={100} required autoComplete="name" className={FIELD_CLASS} /></div>
    <div><p className="text-sm font-medium">{t('email')}</p><p className="mt-1 break-all text-sm text-muted-foreground">{email}</p></div>
    <Button type="submit" variant="brand" disabled={pending}>{t('save')}</Button>
    {status && <p role={status === 'error' ? 'alert' : 'status'} className={status === 'error' ? 'text-sm text-destructive' : 'text-sm text-success'}>{t(status)}</p>}
  </form>
}
