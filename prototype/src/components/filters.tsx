import { useState } from 'react'
import { ChevronDown, SlidersHorizontal } from 'lucide-react'
import { CATEGORIES, COMPANIES, JOB_TYPE_LABEL, LANGS, STATES, type JobType } from '../data/mock'
import { COMPANY_TAG_LABEL, INDUSTRIES, LANDMARKS, type CompanyTag } from '../data/taxonomy'
import { activeFilterCount, type JobFilters } from '../lib/filters'
import { cn } from '../lib/utils'
import { Chip } from './ui'

const SIZES = [...new Set(COMPANIES.map((c) => c.size))]
const RADII = [3, 5, 10, 20]

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2 border-t border-gray-100 py-3 first:border-t-0 sm:flex-row sm:items-start">
      <span className="w-20 shrink-0 pt-1 text-sm text-gray-500">{label}</span>
      <div className="flex min-w-0 flex-wrap gap-2">{children}</div>
    </div>
  )
}

/** 筛选面板：像订酒店一样，常用项一排摆开，其余收在"更多筛选"里；不选就不限 */
export function FilterPanel({ value, onChange, bands }: { value: JobFilters; onChange: (f: JobFilters) => void; bands: number[] }) {
  const [open, setOpen] = useState(false)
  const set = (p: Partial<JobFilters>) => onChange({ ...value, ...p })
  const toggle = <K extends keyof JobFilters>(k: K, v: JobFilters[K]) => set({ [k]: value[k] === v ? undefined : v } as Partial<JobFilters>)
  const parent = value.industry?.split('.')[0]
  const parentNode = INDUSTRIES.find((n) => n.code === parent)
  const count = activeFilterCount(value)

  return (
    <div className="rounded-xl bg-white p-3 shadow-[0_1px_2px_rgba(16,24,40,0.04)] sm:px-4">
      <Row label="职位类型">
        {(Object.keys(JOB_TYPE_LABEL) as JobType[]).map((t) => <Chip key={t} active={value.type === t} onClick={() => toggle('type', t)}>{JOB_TYPE_LABEL[t]}</Chip>)}
      </Row>
      <Row label="薪资">
        {bands.map((b) => <Chip key={b} active={value.salaryAtLeast === b} onClick={() => toggle('salaryAtLeast', b)}>{b.toLocaleString()}+</Chip>)}
      </Row>
      <Row label="工作地点">
        {STATES.slice(0, 6).map((s) => <Chip key={s} active={value.state === s} onClick={() => toggle('state', s)}>{s}</Chip>)}
      </Row>

      {open && (
        <>
          <Row label="公司行业">
            {INDUSTRIES.map((n) => <Chip key={n.code} active={parent === n.code} onClick={() => set({ industry: parent === n.code ? undefined : n.code })}>{n.name}</Chip>)}
          </Row>
          {parentNode?.children && (
            <Row label={`· ${parentNode.name}`}>
              {parentNode.children.map((c) => <Chip key={c.code} active={value.industry === c.code} onClick={() => set({ industry: value.industry === c.code ? parentNode.code : c.code })}>{c.name}</Chip>)}
            </Row>
          )}
          <Row label="公司定位">
            {(Object.keys(COMPANY_TAG_LABEL) as CompanyTag[]).map((t) => {
              const on = value.tags?.includes(t) ?? false
              const tags = on ? value.tags!.filter((x) => x !== t) : [...(value.tags ?? []), t]
              return <Chip key={t} active={on} onClick={() => set({ tags: tags.length ? tags : undefined })}>{COMPANY_TAG_LABEL[t]}</Chip>
            })}
          </Row>
          <Row label="公司规模">
            {SIZES.map((s) => <Chip key={s} active={value.size === s} onClick={() => toggle('size', s)}>{s}</Chip>)}
          </Row>
          <Row label="职位类别">
            {CATEGORIES.map((c) => <Chip key={c.key} active={value.cat === c.key} onClick={() => toggle('cat', c.key)}>{c.name}</Chip>)}
          </Row>
          <Row label="语言要求">
            {LANGS.slice(0, 4).map((l) => <Chip key={l} active={value.lang === l} onClick={() => toggle('lang', l)}>{l}</Chip>)}
          </Row>
          <Row label="工作资格">
            <Chip active={value.pass === 'sp'} onClick={() => toggle('pass', 'sp')}>接受学生准证</Chip>
            <Chip active={value.pass === 'wp'} onClick={() => toggle('pass', 'wp')}>可协助办工作准证</Chip>
          </Row>
          <Row label="附近">
            <select
              aria-label="选择地标"
              value={value.near?.landmarkId ?? ''}
              onChange={(e) => set({ near: e.target.value ? { landmarkId: e.target.value, radiusKm: value.near?.radiusKm ?? 5 } : undefined })}
              className={cn('h-8 cursor-pointer rounded-full border bg-white pl-3 pr-2 text-sm outline-none', value.near ? 'border-brand-500 text-brand-600' : 'border-gray-200 text-gray-600')}
            >
              <option value="">选择商圈、地铁站或学校</option>
              {LANDMARKS.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
            {value.near && RADII.map((r) => <Chip key={r} active={value.near!.radiusKm === r} onClick={() => set({ near: { ...value.near!, radiusKm: r } })}>{r} 公里内</Chip>)}
          </Row>
        </>
      )}

      <div className="flex items-center gap-3 border-t border-gray-100 pt-3">
        <button type="button" onClick={() => setOpen(!open)} className="flex cursor-pointer items-center gap-1 text-sm text-brand-500">
          <SlidersHorizontal className="size-4" />{open ? '收起筛选' : '更多筛选'}<ChevronDown className={cn('size-4 transition', open && 'rotate-180')} />
        </button>
        {count > 0 && <span className="text-sm text-gray-500">已选 {count} 项</span>}
        {count > 0 && <button type="button" onClick={() => onChange({})} className="cursor-pointer text-sm text-gray-400 hover:text-brand-500">清空</button>}
      </div>
    </div>
  )
}
