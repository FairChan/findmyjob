'use client'
import { useState, useTransition } from 'react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
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

  const [phone, setPhone] = useState(initial.phone ?? '')
  const [email, setEmail] = useState(initial.email ?? '')
  const [whatsapp, setWhatsapp] = useState(initial.whatsapp ?? '')
  const [wechat, setWechat] = useState(initial.wechat ?? '')
  const [linkedinUrl, setLinkedinUrl] = useState(initial.linkedinUrl ?? '')

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setStatus('idle')
    startTransition(async () => {
      const res = await updateOwnContactAction({
        phone: phone || null,
        email: email || null,
        whatsapp: whatsapp || null,
        wechat: wechat || null,
        linkedinUrl: linkedinUrl || null,
      })
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
      <div className="rounded-lg border border-blue-200 bg-blue-50 p-4 text-sm text-blue-800">
        {t('privacyNotice')}
      </div>

      <div className="space-y-4">
        <div>
          <Label htmlFor="contact-phone">{t('phoneLabel')}</Label>
          <Input
            id="contact-phone"
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder={t('phonePlaceholder')}
            autoComplete="tel"
            className="mt-1"
          />
        </div>

        <div>
          <Label htmlFor="contact-email">{t('emailLabel')}</Label>
          <Input
            id="contact-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder={t('emailPlaceholder')}
            autoComplete="email"
            className="mt-1"
          />
        </div>

        <div>
          <Label htmlFor="contact-whatsapp">{t('whatsappLabel')}</Label>
          <Input
            id="contact-whatsapp"
            type="tel"
            value={whatsapp}
            onChange={(e) => setWhatsapp(e.target.value)}
            placeholder={t('whatsappPlaceholder')}
            autoComplete="tel"
            className="mt-1"
          />
        </div>

        <div>
          <Label htmlFor="contact-wechat">{t('wechatLabel')}</Label>
          <Input
            id="contact-wechat"
            type="text"
            value={wechat}
            onChange={(e) => setWechat(e.target.value)}
            placeholder={t('wechatPlaceholder')}
            autoComplete="off"
            className="mt-1"
          />
        </div>

        <div>
          <Label htmlFor="contact-linkedin">{t('linkedinLabel')}</Label>
          <Input
            id="contact-linkedin"
            type="url"
            value={linkedinUrl}
            onChange={(e) => setLinkedinUrl(e.target.value)}
            placeholder={t('linkedinPlaceholder')}
            autoComplete="url"
            className="mt-1"
          />
        </div>
      </div>

      {status === 'success' && (
        <p className="text-sm text-green-700">{t('saveSuccess')}</p>
      )}
      {status === 'error' && (
        <p className="text-sm text-red-600">
          {errorMsg === 'VALIDATION_ERROR' ? t('errorValidation') : t('saveError')}
        </p>
      )}

      <Button type="submit" disabled={pending} className="min-w-24">
        {pending ? t('saving') : t('save')}
      </Button>
    </form>
  )
}
