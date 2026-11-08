'use client'

import { useState, useTransition } from 'react'
import { useTranslations } from 'next-intl'
import { useRouter } from 'next/navigation'
import { createSchoolAction, updateSchoolAction } from '../actions'
import type { SchoolListItem } from '@/server/services/admin-schools-partners'

interface Props {
  locale: string
  school: SchoolListItem | null
}

export function SchoolForm({ locale, school }: Props) {
  const t = useTranslations('adminSchools')
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  const [nameZh, setNameZh] = useState(school?.nameZh ?? '')
  const [nameEn, setNameEn] = useState(school?.nameEn ?? '')
  const [shortName, setShortName] = useState(school?.shortName ?? '')
  const [country, setCountry] = useState(school?.country ?? 'MY')
  const [state, setState] = useState(school?.state ?? '')
  const [emailDomains, setEmailDomains] = useState(
    school?.emailDomains.join('\n') ?? '',
  )
  const [isPartner, setIsPartner] = useState(school?.isPartner ?? false)
  const [active, setActive] = useState(school?.active ?? true)

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    const domains = emailDomains
      .split('\n')
      .map((d) => d.trim().toLowerCase())
      .filter(Boolean)

    startTransition(async () => {
      let result: { ok: boolean; code?: string }

      if (!school) {
        result = await createSchoolAction({
          nameZh,
          nameEn,
          shortName: shortName || undefined,
          country,
          state: state || undefined,
          emailDomains: domains,
          isPartner,
        })
      } else {
        result = await updateSchoolAction({
          id: school.id,
          data: {
            nameZh,
            nameEn,
            shortName: shortName || undefined,
            country,
            state: state || undefined,
            emailDomains: domains,
            isPartner,
            active,
          },
        })
      }

      if (result.ok) {
        router.push(`/${locale}/admin/schools`)
        router.refresh()
      } else {
        setError(t('errorFailed'))
      }
    })
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <div>
        <label className="block text-sm font-medium mb-1" htmlFor="nameZh">
          {t('nameZhLabel')} *
        </label>
        <input
          id="nameZh"
          value={nameZh}
          onChange={(e) => setNameZh(e.target.value)}
          required
          maxLength={200}
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
        />
      </div>

      <div>
        <label className="block text-sm font-medium mb-1" htmlFor="nameEn">
          {t('nameEnLabel')} *
        </label>
        <input
          id="nameEn"
          value={nameEn}
          onChange={(e) => setNameEn(e.target.value)}
          required
          maxLength={200}
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
        />
      </div>

      <div>
        <label className="block text-sm font-medium mb-1" htmlFor="shortName">
          {t('shortNameLabel')}
        </label>
        <input
          id="shortName"
          value={shortName}
          onChange={(e) => setShortName(e.target.value)}
          maxLength={50}
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium mb-1" htmlFor="country">
            {t('countryLabel')} *
          </label>
          <input
            id="country"
            value={country}
            onChange={(e) => setCountry(e.target.value.toUpperCase())}
            required
            maxLength={2}
            minLength={2}
            pattern="[A-Z]{2}"
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1" htmlFor="state">
            {t('stateLabel')}
          </label>
          <input
            id="state"
            value={state}
            onChange={(e) => setState(e.target.value)}
            maxLength={50}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium mb-1" htmlFor="emailDomains">
          {t('emailDomainsLabel')} *
        </label>
        <textarea
          id="emailDomains"
          value={emailDomains}
          onChange={(e) => setEmailDomains(e.target.value)}
          required
          rows={4}
          placeholder={t('emailDomainsPlaceholder')}
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
        />
      </div>

      <div className="flex items-center gap-2">
        <input
          id="isPartner"
          type="checkbox"
          checked={isPartner}
          onChange={(e) => setIsPartner(e.target.checked)}
          className="rounded border-input"
        />
        <label htmlFor="isPartner" className="text-sm font-medium">
          {t('isPartnerLabel')}
        </label>
      </div>

      {school && (
        <div className="flex items-center gap-2">
          <input
            id="active"
            type="checkbox"
            checked={active}
            onChange={(e) => setActive(e.target.checked)}
            className="rounded border-input"
          />
          <label htmlFor="active" className="text-sm font-medium">
            {t('activeLabel')}
          </label>
        </div>
      )}

      {error && (
        <p className="text-sm text-destructive">{error}</p>
      )}

      <div className="flex justify-end gap-3">
        <button
          type="submit"
          disabled={isPending}
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          {isPending ? t('saving') : t('saveBtn')}
        </button>
      </div>
    </form>
  )
}
