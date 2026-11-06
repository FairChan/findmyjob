'use client'
import { useState, useTransition } from 'react'
import { useRouter } from '@/i18n/navigation'
import { Button } from '@/components/ui/button'
import { isImeComposing } from '@/lib/ime'

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

export interface JobFormData {
  jobId?: string
  title: string
  type: 'INTERNSHIP' | 'FULL_TIME' | 'PART_TIME'
  category?: string
  description: string
  requirements?: string
  benefits?: string
  workMode: 'ONSITE' | 'HYBRID' | 'REMOTE'
  state?: string
  city?: string
  salaryMin?: number
  salaryMax?: number
  salaryVisible: boolean
  languages: string[]
  skills: string[]
  acceptsStudentPass: boolean
  sponsorsWorkPass: boolean
  headcount?: number
  deadline?: string
  updatedAt?: string
}

type ActionResult =
  | { ok: true; data: { id: string; status: string; updatedAt?: string } }
  | { ok: false; code: string }

interface Props {
  mode: 'create' | 'edit'
  isVerified: boolean
  isEditable?: boolean
  initialData?: JobFormData
  onSaveOrSubmit: (input: unknown) => Promise<ActionResult>
  backHref: string
  t: {
    titleLabel: string
    titlePlaceholder: string
    typeLabel: string
    typeInternship: string
    typeFullTime: string
    typePartTime: string
    categoryLabel: string
    categoryPlaceholder: string
    descriptionLabel: string
    descriptionPlaceholder: string
    requirementsLabel: string
    requirementsPlaceholder: string
    benefitsLabel: string
    benefitsPlaceholder: string
    workModeLabel: string
    workModeOnsite: string
    workModeHybrid: string
    workModeRemote: string
    stateLabel: string
    statePlaceholder: string
    cityLabel: string
    cityPlaceholder: string
    salaryMinLabel: string
    salaryMaxLabel: string
    salaryVisibleLabel: string
    languagesLabel: string
    languagesPlaceholder: string
    skillsLabel: string
    skillsPlaceholder: string
    acceptsStudentPassLabel: string
    sponsorsWorkPassLabel: string
    headcountLabel: string
    deadlineLabel: string
    saveDraft: string
    submitReview: string
    saving: string
    saveSuccess: string
    submitSuccess: string
    errorRequired: string
    errorForbidden: string
    errorUnknown: string
    verifiedOnly: string
    back: string
    removeTagLabel: string
  }
}

export default function JobFormClient({
  mode,
  isVerified,
  isEditable = true,
  initialData,
  onSaveOrSubmit,
  backHref,
  t,
}: Props) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [successMsg, setSuccessMsg] = useState<string | null>(null)

  const [title, setTitle] = useState(initialData?.title ?? '')
  const [type, setType] = useState<'INTERNSHIP' | 'FULL_TIME' | 'PART_TIME'>(
    initialData?.type ?? 'INTERNSHIP',
  )
  const [category, setCategory] = useState(initialData?.category ?? '')
  const [description, setDescription] = useState(initialData?.description ?? '')
  const [requirements, setRequirements] = useState(initialData?.requirements ?? '')
  const [benefits, setBenefits] = useState(initialData?.benefits ?? '')
  const [workMode, setWorkMode] = useState<'ONSITE' | 'HYBRID' | 'REMOTE'>(
    initialData?.workMode ?? 'ONSITE',
  )
  const [state, setState] = useState(initialData?.state ?? '')
  const [city, setCity] = useState(initialData?.city ?? '')
  const [salaryMin, setSalaryMin] = useState(initialData?.salaryMin?.toString() ?? '')
  const [salaryMax, setSalaryMax] = useState(initialData?.salaryMax?.toString() ?? '')
  const [salaryVisible, setSalaryVisible] = useState(initialData?.salaryVisible ?? true)
  const [languagesInput, setLanguagesInput] = useState('')
  const [languages, setLanguages] = useState<string[]>(initialData?.languages ?? [])
  const [skillsInput, setSkillsInput] = useState('')
  const [skills, setSkills] = useState<string[]>(initialData?.skills ?? [])
  const [acceptsStudentPass, setAcceptsStudentPass] = useState(
    initialData?.acceptsStudentPass ?? false,
  )
  const [sponsorsWorkPass, setSponsorsWorkPass] = useState(
    initialData?.sponsorsWorkPass ?? false,
  )
  const [headcount, setHeadcount] = useState(initialData?.headcount?.toString() ?? '')
  const [deadline, setDeadline] = useState(
    initialData?.deadline ? initialData.deadline.slice(0, 10) : '',
  )
  const [titleError, setTitleError] = useState('')
  const [descError, setDescError] = useState('')
  const [formUpdatedAt, setFormUpdatedAt] = useState(initialData?.updatedAt)

  function addTag(
    input: string,
    setInput: (v: string) => void,
    list: string[],
    setList: (v: string[]) => void,
  ) {
    const val = input.trim()
    if (val && !list.includes(val)) setList([...list, val])
    setInput('')
  }

  function buildPayload(submit: boolean) {
    return {
      ...(mode === 'edit' && initialData?.jobId ? { jobId: initialData.jobId } : {}),
      title,
      type,
      category: category || undefined,
      description,
      requirements: requirements || undefined,
      benefits: benefits || undefined,
      workMode,
      state: state || undefined,
      city: city || undefined,
      salaryMin: salaryMin ? parseInt(salaryMin, 10) : undefined,
      salaryMax: salaryMax ? parseInt(salaryMax, 10) : undefined,
      salaryVisible,
      languages,
      skills,
      acceptsStudentPass,
      sponsorsWorkPass,
      headcount: headcount ? parseInt(headcount, 10) : undefined,
      deadline: deadline ? new Date(deadline).toISOString() : undefined,
      submit,
      ...(formUpdatedAt ? { updatedAt: formUpdatedAt } : {}),
    }
  }

  function validate(): boolean {
    let ok = true
    if (!title.trim()) {
      setTitleError(t.errorRequired)
      ok = false
    } else {
      setTitleError('')
    }
    if (!description.trim()) {
      setDescError(t.errorRequired)
      ok = false
    } else {
      setDescError('')
    }
    return ok
  }

  function handleSave(submit: boolean) {
    if (!validate()) return
    setError(null)
    setSuccessMsg(null)
    startTransition(async () => {
      const result = await onSaveOrSubmit(buildPayload(submit))
      if (!result.ok) {
        if (result.code === 'FORBIDDEN') setError(t.errorForbidden)
        else setError(t.errorUnknown)
        return
      }
      if (result.data.updatedAt) setFormUpdatedAt(result.data.updatedAt)
      setSuccessMsg(submit ? t.submitSuccess : t.saveSuccess)
      if (mode === 'create') {
        router.push(`/e/jobs/${result.data.id}/edit`)
      }
    })
  }

  const disabled = isPending || !isEditable

  return (
    <form
      onSubmit={e => {
        e.preventDefault()
      }}
      className="space-y-6"
    >
      {/* Title */}
      <div>
        <label className="mb-1 block text-sm font-medium">{t.titleLabel}</label>
        <input
          type="text"
          value={title}
          onChange={e => setTitle(e.target.value)}
          placeholder={t.titlePlaceholder}
          disabled={disabled}
          maxLength={200}
          className="w-full rounded-md border px-3 py-2 text-sm disabled:opacity-50"
        />
        {titleError && <p className="mt-1 text-xs text-destructive">{titleError}</p>}
      </div>

      {/* Type */}
      <div>
        <label className="mb-1 block text-sm font-medium">{t.typeLabel}</label>
        <select
          value={type}
          onChange={e => setType(e.target.value as typeof type)}
          disabled={disabled}
          className="w-full rounded-md border px-3 py-2 text-sm disabled:opacity-50"
        >
          <option value="INTERNSHIP">{t.typeInternship}</option>
          <option value="FULL_TIME">{t.typeFullTime}</option>
          <option value="PART_TIME">{t.typePartTime}</option>
        </select>
      </div>

      {/* Category */}
      <div>
        <label className="mb-1 block text-sm font-medium">{t.categoryLabel}</label>
        <input
          type="text"
          value={category}
          onChange={e => setCategory(e.target.value)}
          placeholder={t.categoryPlaceholder}
          disabled={disabled}
          maxLength={100}
          className="w-full rounded-md border px-3 py-2 text-sm disabled:opacity-50"
        />
      </div>

      {/* Description */}
      <div>
        <label className="mb-1 block text-sm font-medium">{t.descriptionLabel}</label>
        <textarea
          value={description}
          onChange={e => setDescription(e.target.value)}
          placeholder={t.descriptionPlaceholder}
          disabled={disabled}
          rows={6}
          maxLength={10000}
          className="w-full rounded-md border px-3 py-2 text-sm disabled:opacity-50"
        />
        {descError && <p className="mt-1 text-xs text-destructive">{descError}</p>}
      </div>

      {/* Requirements */}
      <div>
        <label className="mb-1 block text-sm font-medium">{t.requirementsLabel}</label>
        <textarea
          value={requirements}
          onChange={e => setRequirements(e.target.value)}
          placeholder={t.requirementsPlaceholder}
          disabled={disabled}
          rows={4}
          maxLength={5000}
          className="w-full rounded-md border px-3 py-2 text-sm disabled:opacity-50"
        />
      </div>

      {/* Benefits */}
      <div>
        <label className="mb-1 block text-sm font-medium">{t.benefitsLabel}</label>
        <textarea
          value={benefits}
          onChange={e => setBenefits(e.target.value)}
          placeholder={t.benefitsPlaceholder}
          disabled={disabled}
          rows={3}
          maxLength={5000}
          className="w-full rounded-md border px-3 py-2 text-sm disabled:opacity-50"
        />
      </div>

      {/* Work Mode */}
      <div>
        <label className="mb-1 block text-sm font-medium">{t.workModeLabel}</label>
        <select
          value={workMode}
          onChange={e => setWorkMode(e.target.value as typeof workMode)}
          disabled={disabled}
          className="w-full rounded-md border px-3 py-2 text-sm disabled:opacity-50"
        >
          <option value="ONSITE">{t.workModeOnsite}</option>
          <option value="HYBRID">{t.workModeHybrid}</option>
          <option value="REMOTE">{t.workModeRemote}</option>
        </select>
      </div>

      {/* Location */}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="mb-1 block text-sm font-medium">{t.stateLabel}</label>
          <select
            value={state}
            onChange={e => setState(e.target.value)}
            disabled={disabled}
            className="w-full rounded-md border px-3 py-2 text-sm disabled:opacity-50"
          >
            <option value="">{t.statePlaceholder}</option>
            {MY_STATES.map(s => (
              <option key={s.code} value={s.code}>
                {s.labelZh} / {s.labelEn}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium">{t.cityLabel}</label>
          <input
            type="text"
            value={city}
            onChange={e => setCity(e.target.value)}
            placeholder={t.cityPlaceholder}
            disabled={disabled}
            maxLength={100}
            className="w-full rounded-md border px-3 py-2 text-sm disabled:opacity-50"
          />
        </div>
      </div>

      {/* Salary */}
      <div className="space-y-2">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="mb-1 block text-sm font-medium">{t.salaryMinLabel}</label>
            <input
              type="number"
              value={salaryMin}
              onChange={e => setSalaryMin(e.target.value)}
              min={0}
              disabled={disabled}
              className="w-full rounded-md border px-3 py-2 text-sm disabled:opacity-50"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">{t.salaryMaxLabel}</label>
            <input
              type="number"
              value={salaryMax}
              onChange={e => setSalaryMax(e.target.value)}
              min={0}
              disabled={disabled}
              className="w-full rounded-md border px-3 py-2 text-sm disabled:opacity-50"
            />
          </div>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={salaryVisible}
            onChange={e => setSalaryVisible(e.target.checked)}
            disabled={disabled}
          />
          {t.salaryVisibleLabel}
        </label>
      </div>

      {/* Languages */}
      <div>
        <label className="mb-1 block text-sm font-medium">{t.languagesLabel}</label>
        <div className="flex flex-wrap gap-1 rounded-md border p-2">
          {languages.map(lang => (
            <span
              key={lang}
              className="flex items-center gap-1 rounded bg-muted px-2 py-0.5 text-xs"
            >
              {lang}
              {!disabled && (
                <button
                  type="button"
                  onClick={() => setLanguages(languages.filter(l => l !== lang))}
                  className="ml-1 text-muted-foreground hover:text-foreground"
                  aria-label={`${t.removeTagLabel} ${lang}`}
                >
                  ×
                </button>
              )}
            </span>
          ))}
          {!disabled && (
            <input
              type="text"
              value={languagesInput}
              onChange={e => setLanguagesInput(e.target.value)}
              onKeyDown={e => {
                if (isImeComposing(e)) return
                if (e.key === 'Enter' || e.key === ',') {
                  e.preventDefault()
                  addTag(languagesInput, setLanguagesInput, languages, setLanguages)
                }
              }}
              placeholder={t.languagesPlaceholder}
              maxLength={50}
              className="flex-1 min-w-20 border-0 bg-transparent text-sm outline-none"
            />
          )}
        </div>
      </div>

      {/* Skills */}
      <div>
        <label className="mb-1 block text-sm font-medium">{t.skillsLabel}</label>
        <div className="flex flex-wrap gap-1 rounded-md border p-2">
          {skills.map(skill => (
            <span
              key={skill}
              className="flex items-center gap-1 rounded bg-muted px-2 py-0.5 text-xs"
            >
              {skill}
              {!disabled && (
                <button
                  type="button"
                  onClick={() => setSkills(skills.filter(s => s !== skill))}
                  className="ml-1 text-muted-foreground hover:text-foreground"
                  aria-label={`${t.removeTagLabel} ${skill}`}
                >
                  ×
                </button>
              )}
            </span>
          ))}
          {!disabled && (
            <input
              type="text"
              value={skillsInput}
              onChange={e => setSkillsInput(e.target.value)}
              onKeyDown={e => {
                if (isImeComposing(e)) return
                if (e.key === 'Enter' || e.key === ',') {
                  e.preventDefault()
                  addTag(skillsInput, setSkillsInput, skills, setSkills)
                }
              }}
              placeholder={t.skillsPlaceholder}
              maxLength={100}
              className="flex-1 min-w-20 border-0 bg-transparent text-sm outline-none"
            />
          )}
        </div>
      </div>

      {/* Checkboxes */}
      <div className="space-y-2">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={acceptsStudentPass}
            onChange={e => setAcceptsStudentPass(e.target.checked)}
            disabled={disabled}
          />
          {t.acceptsStudentPassLabel}
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={sponsorsWorkPass}
            onChange={e => setSponsorsWorkPass(e.target.checked)}
            disabled={disabled}
          />
          {t.sponsorsWorkPassLabel}
        </label>
      </div>

      {/* Headcount & Deadline */}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="mb-1 block text-sm font-medium">{t.headcountLabel}</label>
          <input
            type="number"
            value={headcount}
            onChange={e => setHeadcount(e.target.value)}
            min={1}
            max={9999}
            disabled={disabled}
            className="w-full rounded-md border px-3 py-2 text-sm disabled:opacity-50"
          />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium">{t.deadlineLabel}</label>
          <input
            type="date"
            value={deadline}
            onChange={e => setDeadline(e.target.value)}
            disabled={disabled}
            className="w-full rounded-md border px-3 py-2 text-sm disabled:opacity-50"
          />
        </div>
      </div>

      {/* Feedback */}
      {error && <p className="rounded bg-destructive/10 p-3 text-sm text-destructive">{error}</p>}
      {successMsg && (
        <p className="rounded bg-green-50 p-3 text-sm text-green-700">{successMsg}</p>
      )}

      {/* Actions */}
      {isEditable && (
        <div className="flex flex-wrap gap-3 pt-2">
          <Button
            type="button"
            variant="outline"
            disabled={isPending}
            onClick={() => handleSave(false)}
          >
            {isPending ? t.saving : t.saveDraft}
          </Button>
          {isVerified ? (
            <Button type="button" disabled={isPending} onClick={() => handleSave(true)}>
              {isPending ? t.saving : t.submitReview}
            </Button>
          ) : (
            <p className="text-sm text-muted-foreground">{t.verifiedOnly}</p>
          )}
          <Button
            type="button"
            variant="ghost"
            disabled={isPending}
            onClick={() => router.push(backHref)}
          >
            {t.back}
          </Button>
        </div>
      )}
      {!isEditable && (
        <Button
          type="button"
          variant="ghost"
          onClick={() => router.push(backHref)}
        >
          {t.back}
        </Button>
      )}
    </form>
  )
}
