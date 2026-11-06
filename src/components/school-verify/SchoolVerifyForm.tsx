'use client'
import { useState, useTransition } from 'react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  requestSchoolOtpAction,
  verifySchoolOtpAction,
} from '@/server/actions/school-verification'

interface School {
  id: string
  nameZh: string
  nameEn: string
  emailDomains: string[]
}

interface Props {
  schools: School[]
  locale: string
  initiallyVerified: boolean
  verifiedEmail?: string | null
}

type Step = 'choose' | 'otp' | 'done'

function errorKey(code: string): string {
  switch (code) {
    case 'VALIDATION_ERROR':
    case 'email_domain_mismatch':
      return 'errorDomainMismatch'
    case 'email_already_verified':
    case 'email_already_verified_by_another':
      return 'errorAlreadyVerified'
    case 'otp_invalid':
      return 'errorOtpInvalid'
    case 'otp_expired_or_not_found':
      return 'errorOtpExpired'
    case 'RATE_LIMITED':
      return 'errorRateLimited'
    default:
      return 'errorUnknown'
  }
}

export default function SchoolVerifyForm({ schools, locale, initiallyVerified, verifiedEmail }: Props) {
  const t = useTranslations('schoolVerify')
  const [step, setStep] = useState<Step>(initiallyVerified ? 'done' : 'choose')
  const [pendingSend, startSend] = useTransition()
  const [pendingVerify, startVerify] = useTransition()
  const [error, setError] = useState('')
  const [sentEmail, setSentEmail] = useState('')

  const [schoolId, setSchoolId] = useState('')
  const [schoolEmail, setSchoolEmail] = useState('')
  const [otp, setOtp] = useState('')

  function handleSend(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    startSend(async () => {
      const res = await requestSchoolOtpAction({ schoolId, schoolEmail })
      if (res.ok) {
        setSentEmail(schoolEmail)
        setStep('otp')
      } else {
        setError(errorKey(res.code))
      }
    })
  }

  function handleVerify(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    startVerify(async () => {
      const res = await verifySchoolOtpAction({ otp })
      if (res.ok) {
        setStep('done')
      } else {
        setError(errorKey(res.code))
      }
    })
  }

  function handleResend() {
    setStep('choose')
    setOtp('')
    setError('')
  }

  if (step === 'done') {
    return (
      <div className="rounded-lg border border-green-200 bg-green-50 p-6">
        <p className="font-medium text-green-800">
          {initiallyVerified && !sentEmail ? t('alreadyVerified') : t('successMessage')}
        </p>
        {(verifiedEmail || sentEmail) && (
          <p className="mt-1 text-sm text-green-700">{verifiedEmail ?? sentEmail}</p>
        )}
        <Button variant="ghost" size="sm" className="mt-3" onClick={handleResend}>
          {t('changeEmail')}
        </Button>
      </div>
    )
  }

  if (step === 'otp') {
    return (
      <form onSubmit={handleVerify} className="space-y-6">
        <p className="rounded-lg border border-blue-200 bg-blue-50 p-4 text-sm text-blue-800">
          {t('otpSent', { email: sentEmail })}
        </p>

        <div>
          <Label htmlFor="school-otp">{t('otpLabel')}</Label>
          <Input
            id="school-otp"
            type="text"
            inputMode="numeric"
            value={otp}
            onChange={(e) => setOtp(e.target.value)}
            placeholder={t('otpPlaceholder')}
            autoComplete="one-time-code"
            maxLength={6}
            className="mt-1"
            required
          />
        </div>

        {error && <p className="text-sm text-red-600">{t(error as Parameters<typeof t>[0])}</p>}

        <div className="flex items-center gap-3">
          <Button type="submit" disabled={pendingVerify || otp.trim().length === 0} className="min-w-24">
            {pendingVerify ? t('verifyPending') : t('verifyButton')}
          </Button>
          <Button type="button" variant="ghost" onClick={handleResend}>
            {t('resendOtp')}
          </Button>
        </div>
      </form>
    )
  }

  return (
    <form onSubmit={handleSend} className="space-y-6">
      <div>
        <Label htmlFor="school-select">{t('schoolLabel')}</Label>
        <select
          id="school-select"
          value={schoolId}
          onChange={(e) => setSchoolId(e.target.value)}
          required
          className="mt-1 flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          <option value="" disabled>
            {t('schoolPlaceholder')}
          </option>
          {schools.map((s) => (
            <option key={s.id} value={s.id}>
              {locale === 'zh' ? s.nameZh : s.nameEn}
            </option>
          ))}
        </select>
      </div>

      <div>
        <Label htmlFor="school-email">{t('emailLabel')}</Label>
        <Input
          id="school-email"
          type="email"
          value={schoolEmail}
          onChange={(e) => setSchoolEmail(e.target.value)}
          placeholder={t('emailPlaceholder')}
          autoComplete="email"
          className="mt-1"
          required
        />
      </div>

      {error && <p className="text-sm text-red-600">{t(error as Parameters<typeof t>[0])}</p>}

      <Button
        type="submit"
        disabled={pendingSend || !schoolId || !schoolEmail.trim()}
        className="min-w-36"
      >
        {pendingSend ? t('sendOtpPending') : t('sendOtpButton')}
      </Button>
    </form>
  )
}
