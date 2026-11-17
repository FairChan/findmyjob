'use client'

import { Select } from '@/components/ui/select'
import { useState, useTransition } from 'react'
import { useTranslations } from 'next-intl'
import { useRouter } from 'next/navigation'
import {
  createPartnerAction,
  updatePartnerAction,
  deletePartnerAction,
} from '../actions'
import type { PartnerListItem, PARTNER_TYPES } from '@/server/services/admin-schools-partners'

const TYPES: (typeof PARTNER_TYPES)[number][] = [
  'SCHOOL',
  'ALUMNI_ASSOCIATION',
  'SOE',
  'ENTERPRISE',
  'GOVERNMENT',
  'NGO',
]

interface Props {
  locale: string
  partner: PartnerListItem | null
  initialLogoUrl: string | null
}

export function PartnerForm({ locale, partner, initialLogoUrl }: Props) {
  const t = useTranslations('adminPartners')
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  const [name, setName] = useState(partner?.name ?? '')
  const [nameEn, setNameEn] = useState(partner?.nameEn ?? '')
  const [type, setType] = useState<(typeof PARTNER_TYPES)[number]>(
    (partner?.type as (typeof PARTNER_TYPES)[number]) ?? 'ENTERPRISE',
  )
  const [logoKey, setLogoKey] = useState(partner?.logoKey ?? '')
  const [logoUrl, setLogoUrl] = useState<string | null>(initialLogoUrl)
  const [logoUploading, setLogoUploading] = useState(false)
  const [logoError, setLogoError] = useState<string | null>(null)
  const [website, setWebsite] = useState(partner?.website ?? '')
  const [description, setDescription] = useState(partner?.description ?? '')
  const [showOnHome, setShowOnHome] = useState(partner?.showOnHome ?? true)
  const [sortOrder, setSortOrder] = useState(partner?.sortOrder ?? 0)
  const [notes, setNotes] = useState(partner?.notes ?? '')

  async function handleLogoUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setLogoUploading(true)
    setLogoError(null)
    try {
      const form = new FormData()
      form.append('file', file)
      const res = await fetch('/api/uploads/PARTNER_LOGO', { method: 'POST', body: form })
      const json = (await res.json()) as { ok: boolean; key?: string }
      if (!json.ok || !json.key) {
        setLogoError(t('logoError'))
        return
      }
      setLogoKey(json.key)
      setLogoUrl(URL.createObjectURL(file))
    } catch {
      setLogoError(t('logoError'))
    } finally {
      setLogoUploading(false)
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    startTransition(async () => {
      let result: { ok: boolean; code?: string }

      if (!partner) {
        result = await createPartnerAction({
          name,
          nameEn: nameEn || undefined,
          type,
          logoKey: logoKey || undefined,
          website: website || undefined,
          description: description || undefined,
          showOnHome,
          sortOrder,
          notes: notes || undefined,
        })
      } else {
        result = await updatePartnerAction({
          id: partner.id,
          // Send the raw strings: an emptied field must reach the service as '' so it is
          // stored as null. `x || undefined` would make updatePartner skip the field and
          // leave the old value (e.g. a removed website) on the public pages.
          data: {
            name,
            nameEn,
            type,
            logoKey,
            website,
            description,
            showOnHome,
            sortOrder,
            notes,
          },
        })
      }

      if (result.ok) {
        router.push(`/${locale}/admin/partners`)
        router.refresh()
      } else {
        setError(t('errorFailed'))
      }
    })
  }

  async function handleDelete() {
    if (!partner) return
    if (!window.confirm(t('deleteConfirm'))) return
    setError(null)

    startTransition(async () => {
      const result = await deletePartnerAction({ id: partner.id })
      if (result.ok) {
        router.push(`/${locale}/admin/partners`)
        router.refresh()
      } else {
        setError(t('errorFailed'))
      }
    })
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <div>
        <label className="block text-sm font-medium mb-1" htmlFor="name">
          {t('nameLabel')} *
        </label>
        <input
          id="name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          maxLength={200}
          className="w-full rounded-control border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
        />
      </div>

      <div>
        <label className="block text-sm font-medium mb-1" htmlFor="nameEn">
          {t('nameEnLabel')}
        </label>
        <input
          id="nameEn"
          value={nameEn}
          onChange={(e) => setNameEn(e.target.value)}
          maxLength={200}
          className="w-full rounded-control border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
        />
      </div>

      <div>
        <label className="block text-sm font-medium mb-1" htmlFor="type">
          {t('typeLabel')} *
        </label>
        <Select
          id="type"
          value={type}
          onChange={(e) => setType(e.target.value as (typeof PARTNER_TYPES)[number])}
          required
          className="w-full rounded-control border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
        >
          {TYPES.map((pt) => (
            <option key={pt} value={pt}>
              {t(`type${pt}` as 'typeSCHOOL')}
            </option>
          ))}
        </Select>
      </div>

      <div>
        <label className="block text-sm font-medium mb-2">
          {t('logoLabel')}
        </label>
        <div className="flex items-center gap-4">
          {logoUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={logoUrl}
              alt="Logo preview"
              className="h-12 w-12 rounded object-contain border border-border"
            />
          )}
          <label
            htmlFor="logoFile"
            className="cursor-pointer rounded-control border border-input px-3 py-2 text-sm hover:bg-muted"
          >
            {logoUploading ? t('uploading') : t('uploadLogoBtn')}
            <input
              id="logoFile"
              type="file"
              accept="image/png,image/jpeg"
              onChange={handleLogoUpload}
              disabled={logoUploading}
              className="sr-only"
            />
          </label>
        </div>
        {logoError && <p className="mt-1 text-xs text-destructive">{logoError}</p>}
      </div>

      <div>
        <label className="block text-sm font-medium mb-1" htmlFor="website">
          {t('websiteLabel')}
        </label>
        <input
          id="website"
          type="url"
          value={website}
          onChange={(e) => setWebsite(e.target.value)}
          maxLength={500}
          placeholder={t('websitePlaceholder')}
          className="w-full rounded-control border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
        />
      </div>

      <div>
        <label className="block text-sm font-medium mb-1" htmlFor="description">
          {t('descriptionLabel')}
        </label>
        <textarea
          id="description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          maxLength={2000}
          rows={3}
          className="w-full rounded-control border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium mb-1" htmlFor="sortOrder">
            {t('sortOrderLabel')}
          </label>
          <input
            id="sortOrder"
            type="number"
            min={0}
            value={sortOrder}
            onChange={(e) => setSortOrder(parseInt(e.target.value, 10) || 0)}
            className="w-full rounded-control border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>
        <div className="flex items-end pb-2">
          <div className="flex items-center gap-2">
            <input
              id="showOnHome"
              type="checkbox"
              checked={showOnHome}
              onChange={(e) => setShowOnHome(e.target.checked)}
              className="rounded border-input"
            />
            <label htmlFor="showOnHome" className="text-sm font-medium">
              {t('showOnHomeLabel')}
            </label>
          </div>
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium mb-1" htmlFor="notes">
          {t('notesLabel')}
        </label>
        <textarea
          id="notes"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          maxLength={2000}
          rows={2}
          className="w-full rounded-control border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
        />
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="flex justify-between gap-3">
        {partner && (
          <button
            type="button"
            onClick={handleDelete}
            disabled={isPending}
            className="rounded-control border border-destructive px-4 py-2 text-sm font-medium text-destructive hover:bg-destructive/10 disabled:opacity-50"
          >
            {t('deleteBtn')}
          </button>
        )}
        <div className="ml-auto">
          <button
            type="submit"
            disabled={isPending}
            className="rounded-control bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {isPending ? t('saving') : t('saveBtn')}
          </button>
        </div>
      </div>
    </form>
  )
}
