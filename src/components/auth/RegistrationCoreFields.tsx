'use client'
import { useTranslations } from 'next-intl'
import { Link } from '@/i18n/navigation'
import type { RegistrationErrorKey, RegistrationField } from './registration-validation'

const inputClass =
  'w-full rounded-control border border-input bg-background px-3 py-2.5 text-sm outline-none transition-colors focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 aria-[invalid=true]:border-destructive'

interface Props {
  errors: Partial<Record<RegistrationField, RegistrationErrorKey>>
  onFieldChange: (field: RegistrationField) => void
  checkboxClassName?: string
}

function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) return null
  return (
    <p id={id} className="mt-1 text-xs text-destructive">
      {message}
    </p>
  )
}

// Name, email, password and the two required agreements shared by the student and employer forms.
export default function RegistrationCoreFields({ errors, onFieldChange, checkboxClassName = 'mt-0.5 h-6 w-6 shrink-0 rounded border-input accent-brand' }: Props) {
  const t = useTranslations('register')
  const message = (field: RegistrationField) => (errors[field] ? t(errors[field]) : undefined)
  const describedBy = (field: RegistrationField) => (errors[field] ? `${field}-error` : undefined)
  const legalLink = (href: '/legal/terms' | '/legal/privacy') => {
    function LegalLink(chunks: React.ReactNode) {
      // New tab so reading the document never discards what the user has typed.
      return (
        <Link href={href} target="_blank" rel="noopener noreferrer" className="text-brand underline underline-offset-4">
          {chunks}
        </Link>
      )
    }
    return LegalLink
  }

  return (
    <>
      <div>
        <label htmlFor="name" className="mb-1 block text-sm font-medium">
          {t('nameLabel')} <span aria-hidden="true" className="text-destructive">*</span>
        </label>
        <input
          id="name"
          name="name"
          type="text"
          required
          maxLength={100}
          autoComplete="name"
          placeholder={t('namePlaceholder')}
          aria-invalid={errors.name ? true : undefined}
          aria-describedby={describedBy('name')}
          onChange={() => onFieldChange('name')}
          className={inputClass}
        />
        <FieldError id="name-error" message={message('name')} />
      </div>

      <div>
        <label htmlFor="email" className="mb-1 block text-sm font-medium">
          {t('emailLabel')} <span aria-hidden="true" className="text-destructive">*</span>
        </label>
        <input
          id="email"
          name="email"
          type="email"
          required
          autoComplete="email"
          placeholder={t('emailPlaceholder')}
          aria-invalid={errors.email ? true : undefined}
          aria-describedby={describedBy('email')}
          onChange={() => onFieldChange('email')}
          className={inputClass}
        />
        <FieldError id="email-error" message={message('email')} />
      </div>

      <div>
        <label htmlFor="password" className="mb-1 block text-sm font-medium">
          {t('passwordLabel')} <span aria-hidden="true" className="text-destructive">*</span>
        </label>
        <input
          id="password"
          name="password"
          type="password"
          required
          minLength={8}
          maxLength={128}
          autoComplete="new-password"
          placeholder={t('passwordPlaceholder')}
          onPaste={(e) => e.stopPropagation()}
          aria-invalid={errors.password ? true : undefined}
          aria-describedby={describedBy('password')}
          onChange={() => onFieldChange('password')}
          className={inputClass}
        />
        <FieldError id="password-error" message={message('password')} />
      </div>

      <div className="space-y-2">
        <div>
          <label className="flex cursor-pointer items-start gap-2">
            <input
              id="agreeTerms"
              name="agreeTerms"
              type="checkbox"
              required
              aria-invalid={errors.agreeTerms ? true : undefined}
              aria-describedby={describedBy('agreeTerms')}
              onChange={() => onFieldChange('agreeTerms')}
              className={checkboxClassName}
            />
            <span className="text-sm">{t.rich('agreeTerms', { terms: legalLink('/legal/terms') })}</span>
          </label>
          <FieldError id="agreeTerms-error" message={message('agreeTerms')} />
        </div>

        <div>
          <label className="flex cursor-pointer items-start gap-2">
            <input
              id="agreePrivacy"
              name="agreePrivacy"
              type="checkbox"
              required
              aria-invalid={errors.agreePrivacy ? true : undefined}
              aria-describedby={describedBy('agreePrivacy')}
              onChange={() => onFieldChange('agreePrivacy')}
              className={checkboxClassName}
            />
            <span className="text-sm">{t.rich('agreePrivacy', { privacy: legalLink('/legal/privacy') })}</span>
          </label>
          <FieldError id="agreePrivacy-error" message={message('agreePrivacy')} />
        </div>
      </div>
    </>
  )
}
