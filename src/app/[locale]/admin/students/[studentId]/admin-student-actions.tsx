'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import {
  suspendUserAction,
  restoreUserAction,
  grantJobViewQuotaAction,
  approveSchoolVerificationAction,
  readStudentContactAdminAction,
} from '@/server/actions/admin-users'

interface Props {
  studentUserId: string
  currentStatus: string
  schoolVerifiedAt: Date | null
}

export function AdminStudentActions({ studentUserId, currentStatus, schoolVerifiedAt }: Props) {
  const t = useTranslations('adminStudents')
  const router = useRouter()

  const [suspendReason, setSuspendReason] = useState('')
  const [suspendError, setSuspendError] = useState('')
  const [suspendLoading, setSuspendLoading] = useState(false)

  const [restoreLoading, setRestoreLoading] = useState(false)
  const [restoreError, setRestoreError] = useState('')

  const [grantAmount, setGrantAmount] = useState('')
  const [grantNote, setGrantNote] = useState('')
  const [grantError, setGrantError] = useState('')
  const [grantSuccess, setGrantSuccess] = useState(false)
  const [grantLoading, setGrantLoading] = useState(false)

  const [verifyLoading, setVerifyLoading] = useState(false)
  const [verifyError, setVerifyError] = useState('')
  const [verifySuccess, setVerifySuccess] = useState(false)

  type ContactData = { phone: string | null; email: string | null; whatsapp: string | null; wechat: string | null; linkedinUrl: string | null }
  const [contact, setContact] = useState<ContactData | null>(null)
  const [contactLoading, setContactLoading] = useState(false)
  const [contactError, setContactError] = useState('')

  async function handleSuspend(e: React.FormEvent) {
    e.preventDefault()
    setSuspendError('')
    if (!suspendReason.trim()) {
      setSuspendError(t('errorReasonRequired'))
      return
    }
    setSuspendLoading(true)
    try {
      const res = await suspendUserAction({ targetUserId: studentUserId, reason: suspendReason.trim() })
      if (res.ok) {
        router.refresh()
      } else {
        setSuspendError(t('errorFailed'))
      }
    } finally {
      setSuspendLoading(false)
    }
  }

  async function handleRestore() {
    setRestoreError('')
    setRestoreLoading(true)
    try {
      const res = await restoreUserAction({ targetUserId: studentUserId })
      if (res.ok) {
        router.refresh()
      } else {
        setRestoreError(t('errorFailed'))
      }
    } finally {
      setRestoreLoading(false)
    }
  }

  async function handleGrant(e: React.FormEvent) {
    e.preventDefault()
    setGrantError('')
    setGrantSuccess(false)
    const amount = parseInt(grantAmount, 10)
    if (!amount || amount < 1) {
      setGrantError(t('errorAmountRequired'))
      return
    }
    if (!grantNote.trim()) {
      setGrantError(t('errorNoteRequired'))
      return
    }
    setGrantLoading(true)
    try {
      const res = await grantJobViewQuotaAction({
        studentUserId,
        amount,
        note: grantNote.trim(),
      })
      if (res.ok) {
        setGrantAmount('')
        setGrantNote('')
        setGrantSuccess(true)
        router.refresh()
      } else {
        setGrantError(t('errorFailed'))
      }
    } finally {
      setGrantLoading(false)
    }
  }

  async function handleViewContact() {
    setContactError('')
    setContactLoading(true)
    try {
      const res = await readStudentContactAdminAction({ studentUserId })
      if (res.ok) {
        setContact(res.data)
      } else {
        setContactError(t('contactErrorFailed'))
      }
    } finally {
      setContactLoading(false)
    }
  }

  async function handleVerify() {
    setVerifyError('')
    setVerifySuccess(false)
    setVerifyLoading(true)
    try {
      const res = await approveSchoolVerificationAction({ studentUserId })
      if (res.ok) {
        setVerifySuccess(true)
        router.refresh()
      } else {
        setVerifyError(t('errorFailed'))
      }
    } finally {
      setVerifyLoading(false)
    }
  }

  return (
    <div className="space-y-6">
      {/* Suspend / restore */}
      <div className="rounded-lg border p-5 space-y-4">
        <h3 className="font-semibold">{t('sectionStatus')}</h3>
        {currentStatus === 'ACTIVE' ? (
          <form onSubmit={handleSuspend} className="space-y-3">
            <div>
              <label htmlFor="suspend-reason" className="text-sm font-medium block mb-1">
                {t('suspendReasonLabel')}
              </label>
              <input
                id="suspend-reason"
                type="text"
                value={suspendReason}
                onChange={(e) => setSuspendReason(e.target.value)}
                placeholder={t('suspendReasonPlaceholder')}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              />
            </div>
            {suspendError && <p className="text-sm text-destructive">{suspendError}</p>}
            <Button type="submit" variant="destructive" disabled={suspendLoading}>
              {suspendLoading ? '…' : t('suspendBtn')}
            </Button>
          </form>
        ) : currentStatus === 'SUSPENDED' ? (
          <div className="space-y-2">
            {restoreError && <p className="text-sm text-destructive">{restoreError}</p>}
            <Button onClick={handleRestore} disabled={restoreLoading} variant="outline">
              {restoreLoading ? '…' : t('restoreBtn')}
            </Button>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">{t('statusDeleted')}</p>
        )}
      </div>

      {/* School verification */}
      {!schoolVerifiedAt && (
        <div className="rounded-lg border p-5 space-y-3">
          <h3 className="font-semibold">{t('sectionSchoolVerify')}</h3>
          <p className="text-sm text-muted-foreground">{t('schoolVerifyDesc')}</p>
          {verifyError && <p className="text-sm text-destructive">{verifyError}</p>}
          {verifySuccess && <p className="text-sm text-green-600">{t('schoolVerifySuccess')}</p>}
          <Button onClick={handleVerify} disabled={verifyLoading} variant="outline">
            {verifyLoading ? '…' : t('schoolVerifyBtn')}
          </Button>
        </div>
      )}

      {/* Contact information */}
      <div className="rounded-lg border p-5 space-y-3">
        <h3 className="font-semibold">{t('sectionContact')}</h3>
        {contact ? (
          <dl className="space-y-2 text-sm">
            {contact.phone && (
              <div className="flex justify-between">
                <dt className="text-muted-foreground">{t('contactPhone')}</dt>
                <dd className="font-mono text-xs">{contact.phone}</dd>
              </div>
            )}
            {contact.email && (
              <div className="flex justify-between">
                <dt className="text-muted-foreground">{t('contactEmail')}</dt>
                <dd className="font-mono text-xs">{contact.email}</dd>
              </div>
            )}
            {contact.whatsapp && (
              <div className="flex justify-between">
                <dt className="text-muted-foreground">{t('contactWhatsapp')}</dt>
                <dd className="font-mono text-xs">{contact.whatsapp}</dd>
              </div>
            )}
            {contact.wechat && (
              <div className="flex justify-between">
                <dt className="text-muted-foreground">{t('contactWechat')}</dt>
                <dd className="font-mono text-xs">{contact.wechat}</dd>
              </div>
            )}
            {contact.linkedinUrl && (
              <div className="flex justify-between">
                <dt className="text-muted-foreground">{t('contactLinkedin')}</dt>
                <dd className="font-mono text-xs break-all">{contact.linkedinUrl}</dd>
              </div>
            )}
            {!contact.phone && !contact.email && !contact.whatsapp && !contact.wechat && !contact.linkedinUrl && (
              <p className="text-muted-foreground text-sm">{t('contactEmpty')}</p>
            )}
          </dl>
        ) : (
          <div className="space-y-2">
            {contactError && <p className="text-sm text-destructive">{contactError}</p>}
            <Button onClick={handleViewContact} disabled={contactLoading} variant="outline">
              {contactLoading ? '…' : t('viewContactBtn')}
            </Button>
          </div>
        )}
      </div>

      {/* Grant job view quota */}
      <div className="rounded-lg border p-5 space-y-4">
        <h3 className="font-semibold">{t('sectionGrantQuota')}</h3>
        <form onSubmit={handleGrant} className="space-y-3">
          <div>
            <label htmlFor="grant-amount" className="text-sm font-medium block mb-1">
              {t('grantAmountLabel')}
            </label>
            <input
              id="grant-amount"
              type="number"
              min="1"
              max="1000"
              value={grantAmount}
              onChange={(e) => setGrantAmount(e.target.value)}
              placeholder="10"
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label htmlFor="grant-note" className="text-sm font-medium block mb-1">
              {t('grantNoteLabel')}
            </label>
            <input
              id="grant-note"
              type="text"
              value={grantNote}
              onChange={(e) => setGrantNote(e.target.value)}
              placeholder={t('grantNotePlaceholder')}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            />
          </div>
          {grantError && <p className="text-sm text-destructive">{grantError}</p>}
          {grantSuccess && <p className="text-sm text-green-600">{t('grantSuccess')}</p>}
          <Button type="submit" disabled={grantLoading}>
            {grantLoading ? '…' : t('grantBtn')}
          </Button>
        </form>
      </div>
    </div>
  )
}
