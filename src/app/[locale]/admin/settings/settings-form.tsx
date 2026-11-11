'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { updateSettingAction } from './actions'
import { parseSettingValue } from './parse-value'
import type { SettingDisplay } from '@/server/services/admin-settings'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'

interface GroupProps {
  group: string
  settings: SettingDisplay[]
}

/** Keys whose changes require an explicit confirmation dialog before saving. */
const HIGH_IMPACT_DESC: Record<string, string> = {
  'legal.currentVersion': 'confirmDescLegalVersion',
  'billing.enabled': 'confirmDescBillingEnabled',
  'unlock.enabled': 'confirmDescUnlockEnabled',
  'uploads.enabled': 'confirmDescUploadsEnabled',
  'talentPool.searchEnabled': 'confirmDescTalentPoolSearch',
}

function SettingRow({ setting }: { setting: SettingDisplay }) {
  const t = useTranslations('adminSettings')
  const [localValue, setLocalValue] = useState<string>(
    valueToString(setting.currentValue),
  )
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)

  const isBoolean = typeof setting.defaultValue === 'boolean'
  const isArray = Array.isArray(setting.defaultValue)
  const isEnum = setting.key === 'search.defaultMode'
  const confirmDescKey = HIGH_IMPACT_DESC[setting.key]
  const isHighImpact = !!confirmDescKey

  async function doSave() {
    setConfirmOpen(false)
    setSaving(true)
    setError('')
    setSuccess(false)
    try {
      const parsed = parseSettingValue(localValue, setting.defaultValue)
      const res = await updateSettingAction({ key: setting.key, value: parsed })
      if (res.ok) {
        setSuccess(true)
        setTimeout(() => setSuccess(false), 3000)
      } else {
        setError(res.code === 'VALIDATION_ERROR' ? t('errorInvalidValue') : t('errorSaveFailed'))
      }
    } catch {
      setError(t('errorSaveFailed'))
    } finally {
      setSaving(false)
    }
  }

  function handleSave() {
    if (isHighImpact) {
      setConfirmOpen(true)
    } else {
      void doSave()
    }
  }

  return (
    <>
      <tr className="border-b hover:bg-muted/30">
        <td className="p-3 font-mono text-xs text-muted-foreground align-middle whitespace-nowrap">
          {setting.key}
          {setting.p1 && (
            <span className="ml-1 inline-flex items-center rounded-full bg-warning-muted px-1.5 py-0.5 text-[10px] text-warning">
              P1
            </span>
          )}
        </td>
        <td className="p-3 align-middle">
          {isBoolean ? (
            <select
              value={localValue}
              onChange={(e) => setLocalValue(e.target.value)}
              className="rounded-control border border-input bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            >
              <option value="true">{t('boolTrue')}</option>
              <option value="false">{t('boolFalse')}</option>
            </select>
          ) : isEnum ? (
            <select
              value={localValue}
              onChange={(e) => setLocalValue(e.target.value)}
              className="rounded-control border border-input bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            >
              <option value="EXACT">EXACT</option>
              <option value="RELATED">RELATED</option>
            </select>
          ) : (
            <input
              type="text"
              value={localValue}
              onChange={(e) => setLocalValue(e.target.value)}
              className="w-48 rounded-control border border-input bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              placeholder={isArray ? t('arrayHint') : ''}
            />
          )}
        </td>
        <td className="p-3 text-xs text-muted-foreground align-middle font-mono whitespace-nowrap">
          {valueToString(setting.defaultValue)}
        </td>
        <td className="p-3 align-middle whitespace-nowrap">
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="rounded-control bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {saving ? t('saving') : t('save')}
          </button>
          {success && (
            <span className="ml-2 text-xs text-success">{t('saved')}</span>
          )}
          {error && (
            <span className="ml-2 text-xs text-destructive">{error}</span>
          )}
        </td>
      </tr>
      {isHighImpact && (
        <Dialog open={confirmOpen} onOpenChange={(open) => { if (!open) setConfirmOpen(false) }}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{t('confirmTitle')}</DialogTitle>
              <DialogDescription>
                {t(confirmDescKey as Parameters<typeof t>[0])}
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => setConfirmOpen(false)}>
                {t('confirmCancel')}
              </Button>
              <Button onClick={() => void doSave()}>
                {t('confirmOk')}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </>
  )
}

function SettingGroup({ group, settings }: GroupProps) {
  const t = useTranslations('adminSettings')
  return (
    <section className="mb-8">
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
        {t(`group_${group}` as Parameters<typeof t>[0])}
      </h2>
      <div className="overflow-x-auto rounded-control border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/50">
              <th className="p-3 text-left font-medium text-xs">{t('colKey')}</th>
              <th className="p-3 text-left font-medium text-xs">{t('colValue')}</th>
              <th className="p-3 text-left font-medium text-xs">{t('colDefault')}</th>
              <th className="p-3 text-left font-medium text-xs">{t('colAction')}</th>
            </tr>
          </thead>
          <tbody>
            {settings.map((s) => (
              <SettingRow key={s.key} setting={s} />
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

export function SettingsForm({ settings }: { settings: SettingDisplay[] }) {
  const groups = [...new Set(settings.map((s) => s.group))]
  const byGroup = new Map<string, SettingDisplay[]>()
  for (const s of settings) {
    if (!byGroup.has(s.group)) byGroup.set(s.group, [])
    byGroup.get(s.group)!.push(s)
  }

  return (
    <div>
      {groups.map((g) => (
        <SettingGroup key={g} group={g} settings={byGroup.get(g)!} />
      ))}
    </div>
  )
}

function valueToString(value: unknown): string {
  if (Array.isArray(value)) return value.join(', ')
  if (typeof value === 'boolean') return String(value)
  if (typeof value === 'number') return String(value)
  return String(value ?? '')
}
