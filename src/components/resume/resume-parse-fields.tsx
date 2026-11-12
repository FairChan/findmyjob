'use client'

import { useId } from 'react'
import { useTranslations } from 'next-intl'
import type { ResumeSuggestionV1 } from '@/server/schemas/resume-parsing'

export const RESUME_GROUPS = ['headline', 'summary', 'skills', 'languages', 'educations', 'experiences'] as const
export type ResumeGroup = typeof RESUME_GROUPS[number]
type EntryGroup = 'languages' | 'educations' | 'experiences'
type Field = { name: string; max?: number; multiline?: boolean; date?: boolean; options?: readonly string[] }
const FIELDS: Record<EntryGroup, readonly Field[]> = {
  languages: [{ name: 'language', max: 20 }, { name: 'level', options: ['BASIC', 'CONVERSATIONAL', 'FLUENT', 'NATIVE'] }],
  educations: [
    { name: 'schoolName', max: 200 }, { name: 'degreeLevel', options: ['', 'FOUNDATION', 'DIPLOMA', 'BACHELOR', 'MASTER', 'PHD'] },
    { name: 'major', max: 100 }, { name: 'startDate', date: true }, { name: 'endDate', date: true },
    { name: 'gpa', max: 20 }, { name: 'description', max: 1000, multiline: true },
  ],
  experiences: [
    { name: 'kind', options: ['INTERNSHIP', 'WORK', 'PROJECT', 'CAMPUS', 'AWARD'] }, { name: 'title', max: 200 },
    { name: 'organization', max: 200 }, { name: 'startDate', date: true }, { name: 'endDate', date: true },
    { name: 'description', max: 1000, multiline: true },
  ],
}
const BLANK = {
  languages: { language: '', level: 'BASIC' },
  educations: { schoolName: '', degreeLevel: null, major: null, startDate: null, endDate: null, gpa: null, description: null },
  experiences: { kind: 'WORK', title: '', organization: null, startDate: null, endDate: null, description: null },
} as const
const inputClass = 'w-full min-w-0 rounded-control border border-input bg-background px-3 py-2 text-base focus-visible:outline-2 focus-visible:outline-ring'

export function ResumeGroupValue({ group, value }: { group: ResumeGroup; value: ResumeSuggestionV1 }) {
  const t = useTranslations('resumeParse')
  const label = (key: string) => t(key as Parameters<typeof t>[0])
  const content = value[group]
  if (content === null || content.length === 0) return <p className="text-sm text-muted-foreground">{t('empty')}</p>
  if (typeof content === 'string') return <p className="whitespace-pre-wrap break-words text-sm [overflow-wrap:anywhere]">{content}</p>
  if (group === 'skills') return <ul className="list-inside list-disc space-y-1 text-sm">{value.skills.map((skill, index) => <li key={index} className="break-words">{skill}</li>)}</ul>
  const entryGroup = group as EntryGroup
  return <ol className="space-y-3 text-sm">{value[entryGroup].map((entry, index) => <li key={index} className="space-y-1 rounded-control border p-3">
    {FIELDS[entryGroup].map(field => {
      const raw = (entry as unknown as Record<string, string | null>)[field.name]
      if (!raw) return null
      const text = field.options ? label('enum.' + raw) : field.date ? raw.slice(0, 10) : raw
      return <p key={field.name} className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]"><span className="font-medium">{label('field.' + field.name)}: </span>{text}</p>
    })}
  </li>)}</ol>
}

export function ResumeGroupEditor({ group, value, onChange }: {
  group: ResumeGroup; value: ResumeSuggestionV1; onChange: (value: ResumeSuggestionV1) => void
}) {
  const t = useTranslations('resumeParse')
  const label = (key: string) => t(key as Parameters<typeof t>[0])
  const id = useId()
  if (group === 'headline' || group === 'summary') return <label className="block space-y-2 text-sm">
    <span>{t('editValue')}</span><textarea rows={group === 'summary' ? 5 : 2} maxLength={group === 'summary' ? 2000 : 100}
      value={value[group] ?? ''} onChange={event => onChange({ ...value, [group]: event.target.value || null })} className={inputClass} />
  </label>
  if (group === 'skills') return <label className="block space-y-2 text-sm"><span>{t('skillsLines')}</span>
    <textarea rows={5} value={value.skills.join('\n')} onChange={event => onChange({ ...value, skills: event.target.value.split('\n') })} className={inputClass} />
  </label>
  const entries = value[group]
  function edit(index: number, name: string, next: string) {
    onChange({ ...value, [group]: entries.map((entry, position) => position === index ? { ...entry, [name]: next || null } : entry) })
  }
  return <div className="space-y-3">
    {entries.map((entry, index) => <fieldset key={index} className="min-w-0 space-y-3 rounded-control border p-3">
      <legend className="px-1 text-sm font-medium">{t('entry', { number: index + 1 })}</legend>
      {FIELDS[group].map(field => {
        const inputId = id + '-' + index + '-' + field.name
        const raw = (entry as unknown as Record<string, string | null>)[field.name] ?? ''
        return <div key={field.name} className="space-y-1">
          <label htmlFor={inputId} className="block text-sm">{label('field.' + field.name)}</label>
          {field.options ? <select id={inputId} value={raw} onChange={event => edit(index, field.name, event.target.value)} className={inputClass}>
            {field.options.map(option => <option key={option} value={option}>{option ? label('enum.' + option) : t('notProvided')}</option>)}
          </select> : field.multiline ? <textarea id={inputId} rows={4} maxLength={field.max} value={raw}
            onChange={event => edit(index, field.name, event.target.value)} className={inputClass} />
            : <input id={inputId} type={field.date ? 'date' : 'text'} maxLength={field.max} value={field.date ? raw.slice(0, 10) : raw}
              onChange={event => edit(index, field.name, event.target.value)} className={inputClass} />}
        </div>
      })}
      <button type="button" onClick={() => onChange({ ...value, [group]: entries.filter((_, position) => position !== index) })}
        className="min-h-11 rounded px-2 text-sm text-destructive underline">{t('removeEntry', { number: index + 1 })}</button>
    </fieldset>)}
    <button type="button" disabled={entries.length >= (group === 'experiences' ? 50 : 20)}
      onClick={() => onChange({ ...value, [group]: [...entries, { ...BLANK[group] }] })}
      className="min-h-11 rounded-full border border-input px-4 py-2 text-sm hover:bg-accent disabled:opacity-50">{t('addEntry')}</button>
  </div>
}
