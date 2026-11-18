'use client'
import { Select } from '@/components/ui/select'
import { useState, useTransition } from 'react'
import { useTranslations } from 'next-intl'
import { BadgeCheck } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { FIELD_COMPACT_CLASS } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'
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
      <Card>
        <Badge tone="success">
          <BadgeCheck aria-hidden="true" />
          {initiallyVerified && !sentEmail ? t('alreadyVerified') : t('successMessage')}
        </Badge>
        {(verifiedEmail || sentEmail) && (
          <p className="mt-3 break-all text-body font-medium">{verifiedEmail ?? sentEmail}</p>
        )}
        <Button variant="outline" size="sm" className="mt-5" onClick={handleResend}>
          {t('changeEmail')}
        </Button>
      </Card>
    )
  }

  if (step === 'otp') {
    return (
      <form onSubmit={handleVerify} className="space-y-6">
        <p className="rounded-control bg-brand-muted p-4 text-sm text-brand-muted-foreground">
          {t('otpSent', { email: sentEmail })}
        </p>

        <Card>
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
        </Card>

        {error && (
          <p role="alert" className="text-sm text-destructive">
            {t(error as Parameters<typeof t>[0])}
          </p>
        )}

        <div className="flex flex-wrap items-center gap-3">
          <Button
            type="submit"
            variant="brand"
            disabled={pendingVerify || otp.trim().length === 0}
            className="h-11 min-w-28"
          >
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
      <Card className="space-y-4">
        <div>
          <Label htmlFor="school-select">{t('schoolLabel')}</Label>
          <Select
            id="school-select"
            value={schoolId}
            onChange={(e) => setSchoolId(e.target.value)}
            required
            className={cn(FIELD_COMPACT_CLASS, 'mt-1')}
          >
            <option value="" disabled>
              {t('schoolPlaceholder')}
            </option>
            {schools.map((s) => (
              <option key={s.id} value={s.id}>
                {locale === 'zh' ? s.nameZh : s.nameEn}
              </option>
            ))}
          </Select>
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
      </Card>

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {t(error as Parameters<typeof t>[0])}
        </p>
      )}

      <Button
        type="submit"
        variant="brand"
        disabled={pendingSend || !schoolId || !schoolEmail.trim()}
        className="h-11 min-w-36"
      >
        {pendingSend ? t('sendOtpPending') : t('sendOtpButton')}
      </Button>
    </form>
  )
}
