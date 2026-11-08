'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { updateSettingAction } from './actions'
import type { SettingDisplay } from '@/server/services/admin-settings'

interface GroupProps {
  group: string
  settings: SettingDisplay[]
}

function SettingRow({ setting }: { setting: SettingDisplay }) {
  const t = useTranslations('adminSettings')
  const [localValue, setLocalValue] = useState<string>(
    valueToString(setting.currentValue),
  )
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)

  const isBoolean = typeof setting.defaultValue === 'boolean'
  const isArray = Array.isArray(setting.defaultValue)
  const isEnum = setting.key === 'search.defaultMode'

  async function handleSave() {
    setSaving(true)
    setError('')
    setSuccess(false)
    try {
      const parsed = parseValue(localValue, setting.defaultValue)
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

  return (
    <tr className="border-b hover:bg-muted/30">
      <td className="p-3 font-mono text-xs text-muted-foreground align-middle whitespace-nowrap">
        {setting.key}
        {setting.p1 && (
          <span className="ml-1 inline-flex items-center rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] text-amber-700">
            P1
          </span>
        )}
      </td>
      <td className="p-3 align-middle">
        {isBoolean ? (
          <select
            value={localValue}
            onChange={(e) => setLocalValue(e.target.value)}
            className="rounded-md border border-input bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          >
            <option value="true">{t('boolTrue')}</option>
            <option value="false">{t('boolFalse')}</option>
          </select>
        ) : isEnum ? (
          <select
            value={localValue}
            onChange={(e) => setLocalValue(e.target.value)}
            className="rounded-md border border-input bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          >
            <option value="EXACT">EXACT</option>
            <option value="RELATED">RELATED</option>
          </select>
        ) : (
          <input
            type={isArray ? 'text' : 'text'}
            value={localValue}
            onChange={(e) => setLocalValue(e.target.value)}
            className="w-48 rounded-md border border-input bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
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
          className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          {saving ? t('saving') : t('save')}
        </button>
        {success && (
          <span className="ml-2 text-xs text-green-600">{t('saved')}</span>
        )}
        {error && (
          <span className="ml-2 text-xs text-destructive">{error}</span>
        )}
      </td>
    </tr>
  )
}

function SettingGroup({ group, settings }: GroupProps) {
  const t = useTranslations('adminSettings')
  return (
    <section className="mb-8">
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
        {t(`group_${group}` as Parameters<typeof t>[0])}
      </h2>
      <div className="overflow-x-auto rounded-md border">
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

function parseValue(str: string, defaultValue: unknown): unknown {
  if (typeof defaultValue === 'boolean') {
    return str === 'true'
  }
  if (Array.isArray(defaultValue)) {
    return str.split(',').map((x) => {
      const n = Number(x.trim())
      return Number.isNaN(n) ? x.trim() : n
    })
  }
  if (typeof defaultValue === 'number') {
    const n = Number(str.trim())
    return Number.isNaN(n) ? str.trim() : n
  }
  return str.trim()
}
