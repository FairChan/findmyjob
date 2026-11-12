'use client'

import { useTranslations } from 'next-intl'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { ContactData } from '@/server/services/contact-access'

export function normalizeContact(value: ContactData): ContactData {
  return {
    phone: value.phone?.trim() || null,
    email: value.email?.trim() || null,
    whatsapp: value.whatsapp?.trim() || null,
    wechat: value.wechat?.trim() || null,
    linkedinUrl: value.linkedinUrl?.trim() || null,
  }
}

export function ContactFields({ value, onChange, disabled = false }: {
  value: ContactData
  onChange: (value: ContactData) => void
  disabled?: boolean
}) {
  const t = useTranslations('contact')
  const fields = [
    { key: 'phone', id: 'contact-phone', type: 'tel', label: 'phoneLabel', placeholder: 'phonePlaceholder', autoComplete: 'tel', maxLength: 40 },
    { key: 'email', id: 'contact-email', type: 'email', label: 'emailLabel', placeholder: 'emailPlaceholder', autoComplete: 'email', maxLength: 200 },
    { key: 'whatsapp', id: 'contact-whatsapp', type: 'tel', label: 'whatsappLabel', placeholder: 'whatsappPlaceholder', autoComplete: 'tel', maxLength: 40 },
    { key: 'wechat', id: 'contact-wechat', type: 'text', label: 'wechatLabel', placeholder: 'wechatPlaceholder', autoComplete: 'off', maxLength: 100 },
    { key: 'linkedinUrl', id: 'contact-linkedin', type: 'url', label: 'linkedinLabel', placeholder: 'linkedinPlaceholder', autoComplete: 'url', maxLength: 300 },
  ] as const

  return (
    <div className="space-y-4">
      {fields.map((field) => (
        <div key={field.key}>
          <Label htmlFor={field.id}>{t(field.label)}</Label>
          <Input
            id={field.id}
            name={field.key}
            type={field.type}
            value={value[field.key] ?? ''}
            onChange={(event) => onChange({ ...value, [field.key]: event.target.value })}
            placeholder={t(field.placeholder)}
            autoComplete={field.autoComplete}
            maxLength={field.maxLength}
            disabled={disabled}
            className="mt-1"
          />
        </div>
      ))}
    </div>
  )
}
