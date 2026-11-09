'use client'

import { useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { usePathname, useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  deactivateCompanyAction,
  reactivateCompanyAction,
  setFoundingPartnerAction,
  setCompanyTagsAction,
  adjustCompanyCreditsAction,
} from '@/server/actions/admin-companies'
import { COMPANY_TAGS } from '@/lib/company-tags'
import type { CompanyTagValue } from '@/lib/company-tags'

interface Props {
  companyId: string
  isActive: boolean
  isFoundingPartner: boolean
  currentTags: string[]
  walletBalance: number | null
}

export function AdminCompanyActions({
  companyId,
  isActive,
  isFoundingPartner,
  currentTags,
  walletBalance,
}: Props) {
  const t = useTranslations('adminCompanyManage')
  const securityT = useTranslations('adminSecurity')
  const locale = useLocale()
  const pathname = usePathname()
  const router = useRouter()

  // Deactivate
  const [deactivateReason, setDeactivateReason] = useState('')
  const [deactivateError, setDeactivateError] = useState('')
  const [deactivateLoading, setDeactivateLoading] = useState(false)

  // Reactivate
  const [reactivateLoading, setReactivateLoading] = useState(false)
  const [reactivateError, setReactivateError] = useState('')

  // Founding partner
  const [foundingPartner, setFoundingPartner] = useState(isFoundingPartner)
  const [foundingPartnerLoading, setFoundingPartnerLoading] = useState(false)
  const [foundingPartnerError, setFoundingPartnerError] = useState('')
  const [foundingPartnerSuccess, setFoundingPartnerSuccess] = useState(false)

  // Tags
  const [selectedTags, setSelectedTags] = useState<string[]>(currentTags)
  const [tagsLoading, setTagsLoading] = useState(false)
  const [tagsError, setTagsError] = useState('')
  const [tagsSuccess, setTagsSuccess] = useState(false)

  // Credits
  const [creditDelta, setCreditDelta] = useState('')
  const [creditNote, setCreditNote] = useState('')
  const [creditsLoading, setCreditsLoading] = useState(false)
  const [creditsError, setCreditsError] = useState('')
  const [creditsAuthError, setCreditsAuthError] = useState<'FRESH_SESSION_REQUIRED' | 'TWO_FACTOR_REQUIRED' | null>(null)
  const [creditsSuccess, setCreditsSuccess] = useState('')
  const [currentBalance, setCurrentBalance] = useState(walletBalance)

  async function handleDeactivate(e: React.FormEvent) {
    e.preventDefault()
    setDeactivateError('')
    if (!deactivateReason.trim()) {
      setDeactivateError(t('errorReasonRequired'))
      return
    }
    setDeactivateLoading(true)
    try {
      const res = await deactivateCompanyAction({ companyId, reason: deactivateReason.trim() })
      if (res.ok) {
        router.refresh()
      } else {
        setDeactivateError(t('errorFailed'))
      }
    } finally {
      setDeactivateLoading(false)
    }
  }

  async function handleReactivate() {
    setReactivateError('')
    setReactivateLoading(true)
    try {
      const res = await reactivateCompanyAction({ companyId })
      if (res.ok) {
        router.refresh()
      } else {
        setReactivateError(t('errorFailed'))
      }
    } finally {
      setReactivateLoading(false)
    }
  }

  async function handleFoundingPartner(e: React.FormEvent) {
    e.preventDefault()
    setFoundingPartnerError('')
    setFoundingPartnerSuccess(false)
    setFoundingPartnerLoading(true)
    try {
      const res = await setFoundingPartnerAction({ companyId, isFoundingPartner: foundingPartner })
      if (res.ok) {
        setFoundingPartnerSuccess(true)
        router.refresh()
      } else {
        setFoundingPartnerError(t('errorFailed'))
      }
    } finally {
      setFoundingPartnerLoading(false)
    }
  }

  async function handleTags(e: React.FormEvent) {
    e.preventDefault()
    setTagsError('')
    setTagsSuccess(false)
    setTagsLoading(true)
    try {
      const res = await setCompanyTagsAction({ companyId, tags: selectedTags as CompanyTagValue[] })
      if (res.ok) {
        setTagsSuccess(true)
        router.refresh()
      } else {
        setTagsError(t('errorFailed'))
      }
    } finally {
      setTagsLoading(false)
    }
  }

  async function handleCredits(e: React.FormEvent) {
    e.preventDefault()
    setCreditsError('')
    setCreditsAuthError(null)
    setCreditsSuccess('')
    if (!creditNote.trim()) {
      setCreditsError(t('errorNoteRequired'))
      return
    }
    const delta = parseInt(creditDelta, 10)
    if (isNaN(delta) || delta === 0) {
      setCreditsError(t('errorFailed'))
      return
    }
    setCreditsLoading(true)
    try {
      const res = await adjustCompanyCreditsAction({ companyId, delta, note: creditNote.trim() })
      if (res.ok && res.data) {
        setCurrentBalance(res.data.balanceAfter)
        setCreditsSuccess(t('successCredits', { balance: res.data.balanceAfter }))
        setCreditDelta('')
        setCreditNote('')
        router.refresh()
      } else if (!res.ok && (res.code === 'FRESH_SESSION_REQUIRED' || res.code === 'TWO_FACTOR_REQUIRED')) {
        setCreditsAuthError(res.code)
      } else {
        setCreditsError(t('errorFailed'))
      }
    } finally {
      setCreditsLoading(false)
    }
  }

  function toggleTag(tag: string) {
    setSelectedTags((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag],
    )
  }

  const tagLabelMap: Record<string, string> = {
    FORTUNE_500: t('tagFortune500'),
    MULTINATIONAL: t('tagMultinational'),
    MY_LEADING: t('tagMyLeading'),
    CN_OVERSEAS: t('tagCnOverseas'),
    SOE: t('tagSoe'),
    ALUMNI: t('tagAlumni'),
    CHINESE_MY: t('tagChineseMy'),
  }

  return (
    <div className="space-y-6">
      {/* Deactivate / Reactivate */}
      <section className="rounded-lg border p-5">
        <h2 className="font-semibold mb-3">{t('deactivateTitle')}</h2>
        {isActive ? (
          <form onSubmit={handleDeactivate} className="space-y-3">
            <p className="text-sm text-muted-foreground">{t('deactivateDesc')}</p>
            <div>
              <label
                htmlFor="deactivate-reason"
                className="block text-sm font-medium mb-1"
              >
                {t('deactivateReasonLabel')}
              </label>
              <textarea
                id="deactivate-reason"
                rows={2}
                value={deactivateReason}
                onChange={(e) => setDeactivateReason(e.target.value)}
                placeholder={t('deactivateReasonPlaceholder')}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
            {deactivateError && (
              <p className="text-sm text-destructive">{deactivateError}</p>
            )}
            <button
              type="submit"
              disabled={deactivateLoading}
              className="rounded-md bg-destructive px-4 py-2 text-sm font-medium text-destructive-foreground hover:bg-destructive/90 disabled:opacity-50"
            >
              {t('deactivateBtn')}
            </button>
          </form>
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">{t('reactivateDesc')}</p>
            {reactivateError && (
              <p className="text-sm text-destructive">{reactivateError}</p>
            )}
            <button
              type="button"
              onClick={handleReactivate}
              disabled={reactivateLoading}
              className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {t('reactivateBtn')}
            </button>
          </div>
        )}
      </section>

      {/* Founding partner */}
      <section className="rounded-lg border p-5">
        <h2 className="font-semibold mb-3">{t('foundingPartnerTitle')}</h2>
        <form onSubmit={handleFoundingPartner} className="space-y-3">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={foundingPartner}
              onChange={(e) => setFoundingPartner(e.target.checked)}
              className="h-4 w-4"
            />
            <span className="text-sm">{t('foundingPartnerLabel')}</span>
          </label>
          {foundingPartnerError && (
            <p className="text-sm text-destructive">{foundingPartnerError}</p>
          )}
          {foundingPartnerSuccess && (
            <p className="text-sm text-green-700">{t('successFoundingPartner')}</p>
          )}
          <button
            type="submit"
            disabled={foundingPartnerLoading}
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {t('foundingPartnerSave')}
          </button>
        </form>
      </section>

      {/* Tags */}
      <section className="rounded-lg border p-5">
        <h2 className="font-semibold mb-3">{t('tagsTitle')}</h2>
        <form onSubmit={handleTags} className="space-y-3">
          <div className="flex flex-wrap gap-2">
            {COMPANY_TAGS.map((tag) => (
              <label
                key={tag}
                className={`flex items-center gap-1.5 cursor-pointer rounded-full border px-3 py-1 text-xs transition-colors ${
                  selectedTags.includes(tag)
                    ? 'border-primary bg-primary/10 text-primary'
                    : 'border-input bg-background text-muted-foreground'
                }`}
              >
                <input
                  type="checkbox"
                  checked={selectedTags.includes(tag)}
                  onChange={() => toggleTag(tag)}
                  className="sr-only"
                />
                {tagLabelMap[tag]}
              </label>
            ))}
          </div>
          {tagsError && <p className="text-sm text-destructive">{tagsError}</p>}
          {tagsSuccess && <p className="text-sm text-green-700">{t('successTags')}</p>}
          <button
            type="submit"
            disabled={tagsLoading}
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {t('tagsSave')}
          </button>
        </form>
      </section>

      {/* Credits */}
      <section className="rounded-lg border p-5">
        <h2 className="font-semibold mb-3">{t('creditsTitle')}</h2>
        {currentBalance !== null ? (
          <p className="text-sm text-muted-foreground mb-3">
            {t('creditsCurrentBalance', { balance: currentBalance })}
          </p>
        ) : (
          <p className="text-sm text-muted-foreground mb-3">{t('creditsNoWallet')}</p>
        )}
        {currentBalance !== null && (
          <form onSubmit={handleCredits} className="space-y-3">
            <div>
              <label htmlFor="credits-delta" className="block text-sm font-medium mb-1">
                {t('creditsDeltaLabel')}
              </label>
              <input
                id="credits-delta"
                type="number"
                value={creditDelta}
                onChange={(e) => setCreditDelta(e.target.value)}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
            <div>
              <label htmlFor="credits-note" className="block text-sm font-medium mb-1">
                {t('creditsNoteLabel')}
              </label>
              <textarea
                id="credits-note"
                rows={2}
                value={creditNote}
                onChange={(e) => setCreditNote(e.target.value)}
                placeholder={t('creditsNotePlaceholder')}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
            {creditsError && <p role="alert" className="text-sm text-destructive">{creditsError}</p>}
            {creditsAuthError && (
              <div role="alert" className="space-y-1 text-sm">
                <p className="text-destructive">
                  {securityT(creditsAuthError === 'FRESH_SESSION_REQUIRED' ? 'freshSessionRequired' : 'twoFactorRequired')}
                </p>
                <Link
                  href={creditsAuthError === 'FRESH_SESSION_REQUIRED'
                    ? `/${locale}/login?redirect=${encodeURIComponent(pathname)}`
                    : `/${locale}/two-factor/setup`}
                  prefetch={false}
                  className="inline-flex min-h-10 items-center text-brand underline underline-offset-4"
                >
                  {securityT(creditsAuthError === 'FRESH_SESSION_REQUIRED' ? 'loginAgain' : 'setupTwoFactor')}
                </Link>
              </div>
            )}
            {creditsSuccess && <p className="text-sm text-green-700">{creditsSuccess}</p>}
            <button
              type="submit"
              disabled={creditsLoading}
              className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {t('creditsSubmit')}
            </button>
          </form>
        )}
      </section>
    </div>
  )
}
