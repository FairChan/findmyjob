'use client'
import { Select } from '@/components/ui/select'
import { useState, useTransition } from 'react'
import { useTranslations } from 'next-intl'
import { useRouter } from '@/i18n/navigation'
import { Button } from '@/components/ui/button'
import { normalizeWebsiteInput } from '@/lib/url-utils'
export interface IndustryParent {
  code: string
  labelZh: string
  labelEn: string
  children: Array<{ code: string; labelZh: string; labelEn: string }>
}

const MY_STATES = [
  { code: 'JHR', labelZh: '柔佛', labelEn: 'Johor' },
  { code: 'KDH', labelZh: '吉打', labelEn: 'Kedah' },
  { code: 'KTN', labelZh: '吉兰丹', labelEn: 'Kelantan' },
  { code: 'KUL', labelZh: '吉隆坡', labelEn: 'Kuala Lumpur' },
  { code: 'LBN', labelZh: '纳闽', labelEn: 'Labuan' },
  { code: 'MLK', labelZh: '马六甲', labelEn: 'Melaka' },
  { code: 'NSN', labelZh: '森美兰', labelEn: 'Negeri Sembilan' },
  { code: 'PHG', labelZh: '彭亨', labelEn: 'Pahang' },
  { code: 'PJY', labelZh: '布城', labelEn: 'Putrajaya' },
  { code: 'PLS', labelZh: '玻璃市', labelEn: 'Perlis' },
  { code: 'PNG', labelZh: '槟城', labelEn: 'Penang' },
  { code: 'PRK', labelZh: '霹雳', labelEn: 'Perak' },
  { code: 'SBH', labelZh: '沙巴', labelEn: 'Sabah' },
  { code: 'SGR', labelZh: '雪兰莪', labelEn: 'Selangor' },
  { code: 'SWK', labelZh: '砂拉越', labelEn: 'Sarawak' },
  { code: 'TRG', labelZh: '登嘉楼', labelEn: 'Terengganu' },
]

const COMPANY_SIZES = ['S1_10', 'S11_50', 'S51_200', 'S201_1000', 'S1000_PLUS'] as const

export interface CompanyFormData {
  legalName: string
  displayNameZh?: string
  displayNameEn?: string
  ssmRegNo?: string
  industryCode?: string
  size?: string
  website?: string
  state?: string
  city?: string
  address?: string
  description?: string
  logoKey?: string
}

interface Props {
  mode: 'create' | 'edit'
  industries: IndustryParent[]
  locale: string
  initialData?: CompanyFormData
  onSubmit: (data: CompanyFormData) => Promise<{ ok: boolean; code?: string }>
  companyId?: string
}

export default function CompanyForm({ mode, industries, locale, initialData, onSubmit, companyId }: Props) {
  const tCreate = useTranslations('companyOnboarding')
  const tEdit = useTranslations('companyEdit')
  const t = mode === 'create' ? tCreate : tEdit
  const tO = tCreate
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const [logoKey, setLogoKey] = useState(initialData?.logoKey ?? '')
  const [logoUploading, setLogoUploading] = useState(false)
  const [logoError, setLogoError] = useState<string | null>(null)

  async function handleLogoUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setLogoUploading(true)
    setLogoError(null)
    try {
      const form = new FormData()
      form.append('file', file)
      const res = await fetch('/api/uploads/LOGO', { method: 'POST', body: form })
      const json = (await res.json()) as { ok: boolean; key?: string }
      if (json.ok && json.key) {
        setLogoKey(json.key)
      } else {
        setLogoError(tEdit('logoUploadError'))
      }
    } catch {
      setLogoError(tEdit('logoUploadError'))
    } finally {
      setLogoUploading(false)
    }
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    setSuccess(false)

    const fd = new FormData(e.currentTarget)
    const data: CompanyFormData = {
      legalName: (fd.get('legalName') as string).trim(),
      displayNameZh: (fd.get('displayNameZh') as string).trim() || undefined,
      displayNameEn: (fd.get('displayNameEn') as string).trim() || undefined,
      ssmRegNo: (fd.get('ssmRegNo') as string).trim() || undefined,
      industryCode: (fd.get('industryCode') as string) || undefined,
      size: (fd.get('size') as string) || undefined,
      website: normalizeWebsiteInput(fd.get('website') as string),
      state: (fd.get('state') as string) || undefined,
      city: (fd.get('city') as string).trim() || undefined,
      address: (fd.get('address') as string).trim() || undefined,
      description: (fd.get('description') as string).trim() || undefined,
      ...(mode === 'edit' ? { logoKey: logoKey || undefined } : {}),
    }

    if (!data.legalName || data.legalName.length < 2) {
      setError(tO('errorLegalNameTooShort'))
      return
    }

    startTransition(async () => {
      const result = await onSubmit(data)
      if (result.ok) {
        if (mode === 'create') {
          // The jobs page carries the "submit verification" banner — the next step after creating.
          router.push('/e/jobs')
        } else {
          setSuccess(true)
        }
      } else {
        if (result.code === 'VALIDATION_ERROR') {
          setError(tO('errorCheckFields'))
        } else if (result.code === 'SSM_DUPLICATE') {
          setError(tO('errorSsmDuplicate'))
        } else if (result.code === 'ALREADY_MEMBER') {
          setError(tO('errorAlreadyMember'))
        } else if (result.code === 'IDENTITY_LOCKED') {
          setError(tO('errorIdentityLocked'))
        } else {
          setError(tO('errorUnknown'))
        }
      }
    })
  }

  const inputClass =
    'w-full rounded-control border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring'
  const labelClass = 'block text-sm font-medium mb-1'

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-5">
      {/* Legal name */}
      <div>
        <label htmlFor="legalName" className={labelClass}>
          {tO('legalNameLabel')} <span aria-hidden="true" className="text-destructive">*</span>
        </label>
        <input
          id="legalName"
          name="legalName"
          type="text"
          required
          defaultValue={initialData?.legalName ?? ''}
          placeholder={tO('legalNamePlaceholder')}
          className={inputClass}
        />
      </div>

      {/* Display names */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="displayNameZh" className={labelClass}>
            {tO('displayNameZhLabel')}
          </label>
          <input
            id="displayNameZh"
            name="displayNameZh"
            type="text"
            defaultValue={initialData?.displayNameZh ?? ''}
            placeholder={tO('displayNameZhPlaceholder')}
            className={inputClass}
          />
        </div>
        <div>
          <label htmlFor="displayNameEn" className={labelClass}>
            {tO('displayNameEnLabel')}
          </label>
          <input
            id="displayNameEn"
            name="displayNameEn"
            type="text"
            defaultValue={initialData?.displayNameEn ?? ''}
            placeholder={tO('displayNameEnPlaceholder')}
            className={inputClass}
          />
        </div>
      </div>

      {/* SSM */}
      <div>
        <label htmlFor="ssmRegNo" className={labelClass}>
          {tO('ssmRegNoLabel')}
        </label>
        <input
          id="ssmRegNo"
          name="ssmRegNo"
          type="text"
          defaultValue={initialData?.ssmRegNo ?? ''}
          placeholder={tO('ssmRegNoPlaceholder')}
          className={inputClass}
        />
      </div>

      {/* Industry */}
      <div>
        <label htmlFor="industryCode" className={labelClass}>
          {tO('industryLabel')}
        </label>
        <Select
          id="industryCode"
          name="industryCode"
          defaultValue={initialData?.industryCode ?? ''}
          className={inputClass}
        >
          <option value="">{tO('industryPlaceholder')}</option>
          {industries.map(parent => (
            <optgroup
              key={parent.code}
              label={locale === 'zh' ? parent.labelZh : parent.labelEn}
            >
              {parent.children.map(child => (
                <option key={child.code} value={child.code}>
                  {locale === 'zh' ? child.labelZh : child.labelEn}
                </option>
              ))}
            </optgroup>
          ))}
        </Select>
      </div>

      {/* Size */}
      <div>
        <label htmlFor="size" className={labelClass}>
          {tO('sizeLabel')}
        </label>
        <Select
          id="size"
          name="size"
          defaultValue={initialData?.size ?? ''}
          className={inputClass}
        >
          <option value="">{tO('sizePlaceholder')}</option>
          {COMPANY_SIZES.map(s => (
            <option key={s} value={s}>
              {tO(`size_${s}` as 'size_S1_10')}
            </option>
          ))}
        </Select>
      </div>

      {/* Website */}
      <div>
        <label htmlFor="website" className={labelClass}>
          {tO('websiteLabel')}
        </label>
        <input
          id="website"
          name="website"
          type="url"
          defaultValue={initialData?.website ?? ''}
          placeholder={tO('websitePlaceholder')}
          className={inputClass}
        />
      </div>

      {/* State + City */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="state" className={labelClass}>
            {tO('stateLabel')}
          </label>
          <Select
            id="state"
            name="state"
            defaultValue={initialData?.state ?? ''}
            className={inputClass}
          >
            <option value="">{tO('statePlaceholder')}</option>
            {MY_STATES.map(s => (
              <option key={s.code} value={s.code}>
                {locale === 'zh' ? s.labelZh : s.labelEn}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <label htmlFor="city" className={labelClass}>
            {tO('cityLabel')}
          </label>
          <input
            id="city"
            name="city"
            type="text"
            defaultValue={initialData?.city ?? ''}
            placeholder={tO('cityPlaceholder')}
            className={inputClass}
          />
        </div>
      </div>

      {/* Address */}
      <div>
        <label htmlFor="address" className={labelClass}>
          {tO('addressLabel')}
        </label>
        <input
          id="address"
          name="address"
          type="text"
          defaultValue={initialData?.address ?? ''}
          placeholder={tO('addressPlaceholder')}
          className={inputClass}
        />
      </div>

      {/* Description */}
      <div>
        <label htmlFor="description" className={labelClass}>
          {tO('descriptionLabel')}
        </label>
        <textarea
          id="description"
          name="description"
          rows={4}
          maxLength={2000}
          defaultValue={initialData?.description ?? ''}
          placeholder={tO('descriptionPlaceholder')}
          className={inputClass}
        />
      </div>

      {/* Logo upload (edit mode only) */}
      {mode === 'edit' && (
        <div>
          <label className={labelClass}>{tEdit('logoLabel')}</label>
          <p className="text-xs text-muted-foreground mb-2">{tEdit('logoHint')}</p>
          <div className="flex items-center gap-3">
            <label className="cursor-pointer">
              <span className="inline-flex items-center rounded-control border border-input bg-background px-3 py-2 text-sm hover:bg-accent">
                {logoUploading ? tEdit('logoUploading') : tEdit('logoUploadButton')}
              </span>
              <input
                type="file"
                accept="image/png,image/jpeg"
                className="absolute w-0 h-0 overflow-hidden opacity-0"
                disabled={logoUploading}
                onChange={handleLogoUpload}
              />
            </label>
            {logoKey && (
              <span className="text-xs text-muted-foreground">{tEdit('logoUploaded')}</span>
            )}
          </div>
          {logoError && (
            <p role="alert" className="text-sm text-destructive mt-1">{logoError}</p>
          )}
        </div>
      )}

      {error && (
        <p role="alert" className="text-sm text-destructive">{error}</p>
      )}

      {success && (
        <p role="status" className="text-sm text-success">{tEdit('saveSuccess')}</p>
      )}

      <Button type="submit" className="w-full" disabled={isPending || logoUploading}>
        {isPending
          ? (mode === 'create' ? tO('submitting') : tEdit('submitting'))
          : (mode === 'create' ? tO('submit') : tEdit('submit'))}
      </Button>
    </form>
  )
}
