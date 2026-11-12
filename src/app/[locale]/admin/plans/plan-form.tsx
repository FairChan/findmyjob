'use client'

import { useId, useRef, useState, type FormEvent } from 'react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { createPlanAction, updatePlanAction } from '@/server/actions/admin-plans'
import type { AdminPlanClientRow, PlanWriteInput } from '@/server/services/admin-plans'
import { PlanActionError } from './plan-action-error'
import { usePlanFeedback } from './plan-feedback'

type EditablePlan = AdminPlanClientRow & { kind: 'PLAN' | 'CREDIT_PACK' }
type Draft = {
  code: string
  kind: 'PLAN' | 'CREDIT_PACK'
  nameZh: string
  nameEn: string
  priceSen: string
  credits: string
  durationDays: string
  jobPostLimit: string
  seatLimit: string
  invitationQuota: string
  unlimitedJobs: boolean
  unlimitedSeats: boolean
  unlimitedInvitations: boolean
  isActive: boolean
  isPublic: boolean
  sortOrder: string
}

const MAX_INT = 2_147_483_647
const fieldClass = 'w-full min-w-0 rounded-card border border-border bg-card px-3 py-2 text-base focus-visible:outline-2 focus-visible:outline-brand disabled:bg-muted disabled:text-muted-foreground read-only:bg-muted'

function initialDraft(plan?: EditablePlan): Draft {
  return {
    code: plan?.code ?? '', kind: plan?.kind ?? 'PLAN',
    nameZh: plan?.nameZh ?? '', nameEn: plan?.nameEn ?? '',
    priceSen: plan ? String(plan.priceSen) : '', credits: String(plan?.credits ?? 0),
    durationDays: plan?.durationDays?.toString() ?? '',
    jobPostLimit: plan?.jobPostLimit?.toString() ?? '',
    seatLimit: plan?.seatLimit?.toString() ?? '',
    invitationQuota: plan?.invitationQuota?.toString() ?? '',
    unlimitedJobs: plan?.kind === 'PLAN' && plan.code !== 'FREE' && plan.jobPostLimit === null,
    unlimitedSeats: plan?.kind === 'PLAN' && plan.code !== 'FREE' && plan.seatLimit === null,
    unlimitedInvitations: plan?.kind === 'PLAN' && plan.code !== 'FREE' && plan.invitationQuota === null,
    isActive: plan?.isActive ?? true, isPublic: plan?.isPublic ?? false,
    sortOrder: String(plan?.sortOrder ?? 0),
  }
}

function integer(value: string, minimum = 0): number | undefined {
  if (!/^\d+$/.test(value.trim())) return undefined
  const number = Number(value)
  return Number.isSafeInteger(number) && number >= minimum && number <= MAX_INT ? number : undefined
}

function writeInput(draft: Draft, plan?: EditablePlan): PlanWriteInput | null {
  const code = (plan?.code ?? draft.code).trim().toUpperCase()
  const free = code === 'FREE'
  const kind = plan?.kind ?? (free ? 'PLAN' : draft.kind)
  const pack = kind === 'CREDIT_PACK'
  const priceSen = free ? 0 : integer(draft.priceSen, 1)
  const credits = free ? 0 : integer(draft.credits, pack ? 1 : 0)
  const durationDays = free || pack ? null : integer(draft.durationDays, 1)
  const jobPostLimit = pack || (!free && draft.unlimitedJobs) ? null : integer(draft.jobPostLimit)
  const seatLimit = pack || (!free && draft.unlimitedSeats) ? null : integer(draft.seatLimit, 1)
  const invitationQuota = pack || (!free && draft.unlimitedInvitations) ? null : integer(draft.invitationQuota)
  const sortOrder = integer(draft.sortOrder)
  const nameZh = draft.nameZh.trim()
  const nameEn = draft.nameEn.trim()
  if (!/^[A-Z0-9_]{1,64}$/.test(code) || !nameZh || nameZh.length > 100 || !nameEn || nameEn.length > 100
    || priceSen === undefined || credits === undefined || durationDays === undefined
    || jobPostLimit === undefined || seatLimit === undefined || invitationQuota === undefined || sortOrder === undefined) return null
  return {
    code, kind, nameZh, nameEn, priceSen, credits, durationDays,
    jobPostLimit, seatLimit, invitationQuota, sortOrder,
    isActive: free ? true : draft.isActive, isPublic: draft.isPublic,
  }
}

function NumberField({ id, label, value, onChange, minimum = 0, disabled, readOnly, hint, required = true }: {
  id: string
  label: string
  value: string
  onChange: (value: string) => void
  minimum?: number
  disabled?: boolean
  readOnly?: boolean
  hint?: string
  required?: boolean
}) {
  return (
    <div className="min-w-0 space-y-2">
      <label htmlFor={id} className="text-sm font-medium">{label}</label>
      <input id={id} type="number" inputMode="numeric" min={minimum} max={MAX_INT} step={1} required={required} value={value} onChange={(event) => onChange(event.target.value)} disabled={disabled} readOnly={readOnly} aria-describedby={hint ? id + '-hint' : undefined} className={fieldClass} />
      {hint && <p id={id + '-hint'} className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  )
}

export function PlanForm({ plan }: { plan?: EditablePlan }) {
  const t = useTranslations('adminPlans')
  const id = useId()
  const feedback = usePlanFeedback()
  const inFlight = useRef(false)
  const focusAfterClose = useRef(false)
  const version = useRef(plan?.updatedAt ?? '')
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState(() => initialDraft(plan))
  const [pending, setPending] = useState(false)
  const [errorCode, setErrorCode] = useState('')
  const free = (plan?.code ?? draft.code).trim().toUpperCase() === 'FREE'
  const kind = free ? 'PLAN' : draft.kind
  const pack = kind === 'CREDIT_PACK'

  function update<K extends keyof Draft>(key: K, value: Draft[K]) {
    setDraft((current) => ({ ...current, [key]: value }))
  }

  function changeOpen(value: boolean) {
    if (inFlight.current || (value && feedback.refreshing)) return
    if (value) {
      setDraft(initialDraft(plan))
      version.current = plan?.updatedAt ?? ''
      setErrorCode('')
      focusAfterClose.current = false
    }
    setOpen(value)
  }

  function changeKind(value: Draft['kind']) {
    setDraft((current) => ({
      ...current, kind: value, durationDays: '', jobPostLimit: '', seatLimit: '', invitationQuota: '',
      unlimitedJobs: false, unlimitedSeats: false, unlimitedInvitations: false,
    }))
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (inFlight.current) return
    setErrorCode('')
    const input = writeInput(draft, plan)
    if (!input) {
      setErrorCode('VALIDATION_ERROR')
      return
    }
    inFlight.current = true
    setPending(true)
    try {
      const result = plan
        ? await updatePlanAction({ ...input, id: plan.id, expectedUpdatedAt: version.current })
        : await createPlanAction(input)
      if (result.ok) {
        focusAfterClose.current = true
        feedback.announce(t('saved'))
        setOpen(false)
        feedback.refresh()
      } else {
        setErrorCode(result.code)
      }
    } catch {
      setErrorCode('UNKNOWN')
    } finally {
      inFlight.current = false
      setPending(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogTrigger asChild><Button variant={plan ? 'outline' : 'default'} size={plan ? 'sm' : 'default'} disabled={feedback.refreshing}>{t(plan ? 'edit' : 'new')}</Button></DialogTrigger>
      <DialogContent closeLabel={t('close')} className="max-h-[90dvh] w-[calc(100%_-_2rem)] max-w-3xl overflow-y-auto rounded-card [&>button]:hidden"
        onEscapeKeyDown={(event) => { if (pending) event.preventDefault() }}
        onPointerDownOutside={(event) => { if (pending) event.preventDefault() }}
        onCloseAutoFocus={(event) => { if (focusAfterClose.current) { event.preventDefault(); feedback.focusHeading() } }}>
        <DialogHeader className="pr-9">
          <DialogTitle>{t(plan ? 'editTitle' : 'new')}</DialogTitle>
          <DialogDescription>{t('description')}</DialogDescription>
          <Button type="button" variant="ghost" size="icon" className="absolute right-2 top-2" aria-label={t('close')} disabled={pending} onClick={() => changeOpen(false)}><span aria-hidden="true" className="text-xl">×</span></Button>
        </DialogHeader>
        <form data-testid="plan-form" noValidate onSubmit={submit} aria-busy={pending} aria-describedby={errorCode ? id + '-error' : undefined} className="min-w-0 space-y-5">
          {free && <p className="rounded-card bg-brand-muted p-3 text-sm text-brand">{t('freeProtected')}</p>}
          {plan && <p className="text-xs text-muted-foreground">{t('immutableHint')}</p>}
          <fieldset disabled={pending} className="grid min-w-0 gap-4 sm:grid-cols-2">
            <div className="min-w-0 space-y-2">
              <label htmlFor={id + '-code'} className="text-sm font-medium">{t('code')}</label>
              <input id={id + '-code'} required maxLength={64} value={draft.code} readOnly={!!plan} onChange={(event) => update('code', event.target.value)} aria-describedby={id + '-code-hint'} className={fieldClass} />
              <p id={id + '-code-hint'} className="text-xs text-muted-foreground">{t('codeHint')}</p>
            </div>
            <div className="min-w-0 space-y-2">
              <label htmlFor={id + '-kind'} className="text-sm font-medium">{t('kind')}</label>
              <select id={id + '-kind'} value={kind} disabled={!!plan || free} onChange={(event) => changeKind(event.target.value as Draft['kind'])} aria-describedby={id + '-kind-hint'} className={fieldClass}>
                <option value="PLAN">{t('kinds.PLAN')}</option><option value="CREDIT_PACK">{t('kinds.CREDIT_PACK')}</option>
              </select>
              <p id={id + '-kind-hint'} className="text-xs text-muted-foreground">{t('kindHint')}</p>
            </div>
            {(['nameZh', 'nameEn'] as const).map((key) => <div key={key} className="min-w-0 space-y-2">
              <label htmlFor={id + '-' + key} className="text-sm font-medium">{t(key)}</label>
              <input id={id + '-' + key} required maxLength={100} value={draft[key]} onChange={(event) => update(key, event.target.value)} className={fieldClass} />
            </div>)}
            <NumberField id={id + '-price'} label={t('priceSen')} value={free ? '0' : draft.priceSen} onChange={(value) => update('priceSen', value)} minimum={free ? 0 : 1} readOnly={free} hint={t('priceHint')} />
            <NumberField id={id + '-credits'} label={t('credits')} value={free ? '0' : draft.credits} onChange={(value) => update('credits', value)} minimum={pack ? 1 : 0} readOnly={free} />
            <NumberField id={id + '-duration'} label={t('durationDays')} value={free || pack ? '' : draft.durationDays} onChange={(value) => update('durationDays', value)} minimum={1} disabled={free || pack} required={!free && !pack} hint={t('durationHint')} />
            <NumberField id={id + '-sort'} label={t('sortOrder')} value={draft.sortOrder} onChange={(value) => update('sortOrder', value)} />
            {pack ? <p className="rounded-card bg-muted p-3 text-sm text-foreground sm:col-span-2">{t('noSubscription')}</p> : <>
              <p id={id + '-limits-hint'} className="text-xs text-muted-foreground sm:col-span-2">{t('limitHint')}</p>
              {([
                ['jobPostLimit', 'unlimitedJobs', 0],
                ['seatLimit', 'unlimitedSeats', 1],
                ['invitationQuota', 'unlimitedInvitations', 0],
              ] as const).map(([key, unlimitedKey, minimum]) => <div key={key} className="min-w-0 space-y-2">
                <NumberField id={id + '-' + key} label={t(key)} value={draft[key]} onChange={(value) => update(key, value)} minimum={minimum} disabled={!free && draft[unlimitedKey]} required={free || !draft[unlimitedKey]} />
                <label className="flex min-h-10 items-center gap-3 text-sm"><input type="checkbox" checked={!free && draft[unlimitedKey]} disabled={free} onChange={(event) => update(unlimitedKey, event.target.checked)} aria-describedby={id + '-limits-hint'} className="size-4 accent-brand" />{t(unlimitedKey)}</label>
              </div>)}
            </>}
            <div className="space-y-2 sm:col-span-2">
              <div className="flex flex-wrap gap-x-6 gap-y-2">
                <label className="flex min-h-10 items-center gap-3 text-sm font-medium"><input type="checkbox" checked={free || draft.isActive} disabled={free} onChange={(event) => update('isActive', event.target.checked)} aria-describedby={id + '-visibility-hint'} className="size-4 accent-brand" />{t('active')}</label>
                <label className="flex min-h-10 items-center gap-3 text-sm font-medium"><input type="checkbox" checked={draft.isPublic} onChange={(event) => update('isPublic', event.target.checked)} aria-describedby={id + '-visibility-hint'} className="size-4 accent-brand" />{t('public')}</label>
              </div>
              <p id={id + '-visibility-hint'} className="text-xs text-muted-foreground">{t('visibilityHint')}</p>
            </div>
          </fieldset>
          <PlanActionError id={id + '-error'} code={errorCode} operation={plan ? 'update' : 'create'} />
          {plan && errorCode === 'CONFLICT' && <Button type="button" variant="outline" disabled={pending} className="h-auto min-h-10 whitespace-normal" onClick={() => { focusAfterClose.current = true; setOpen(false); feedback.refresh() }}>{t('reloadLatest')}</Button>}
          <DialogFooter className="gap-2"><Button type="button" variant="outline" disabled={pending} onClick={() => changeOpen(false)}>{t('cancel')}</Button><Button type="submit" disabled={pending}>{t(pending ? 'saving' : 'save')}</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
