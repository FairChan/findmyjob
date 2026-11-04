import { Lock } from 'lucide-react'
import {
  DEGREE_LABEL, JOB_TYPE_LABEL, LANGS, LANG_LEVEL_LABEL, SCHOOLS, STATES, WORK_AUTH_LABEL,
  type Degree, type Experience, type JobType, type LangLevel, type Student, type WorkAuth,
} from '../data/mock'
import { toggleIn } from '../lib/utils'
import { Chip, Field, Input, Select, TagInput, Textarea } from './ui'

// 资料字段组：简历页的编辑弹窗和注册后的分步向导共用，同一个字段只写一遍
type P = { d: Student; set: (p: Partial<Student>) => void }

export function BasicFields({ d, set, withSummary }: P & { withSummary?: boolean }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Field label="姓名" required><Input value={d.fullName} onChange={(e) => set({ fullName: e.target.value })} /></Field>
      <Field label="学校" required>
        <Select value={d.schoolId} onChange={(e) => set({ schoolId: e.target.value })}>
          <option value="">请选择</option>
          {SCHOOLS.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </Select>
      </Field>
      <Field label="学历" required>
        <Select value={d.degree} onChange={(e) => set({ degree: e.target.value as Degree })}>
          {Object.entries(DEGREE_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </Select>
      </Field>
      <Field label="专业" required><Input value={d.major} onChange={(e) => set({ major: e.target.value })} /></Field>
      <Field label="毕业年份" required>
        <Select value={d.gradYear || ''} onChange={(e) => set({ gradYear: +e.target.value, gradMonth: d.gradMonth || 6 })}>
          <option value="">请选择</option>
          {[2026, 2027, 2028, 2029].map((y) => <option key={y} value={y}>{y}</option>)}
        </Select>
      </Field>
      <Field label="CGPA（选填）" hint="满分 4.00，没有可以不填">
        <Input type="number" step="0.01" min={0} max={4} value={d.cgpa ?? ''} onChange={(e) => set({ cgpa: e.target.value === '' ? undefined : Math.min(4, Math.max(0, +e.target.value)) })} />
      </Field>
      <Field label="工作资格" required hint="企业会按这一项筛选，请如实填写" className="sm:col-span-2">
        <Select value={d.workAuth} onChange={(e) => set({ workAuth: e.target.value as WorkAuth })}>
          {Object.entries(WORK_AUTH_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </Select>
      </Field>
      {withSummary && (
        <>
          <Field label="一句话介绍" className="sm:col-span-2"><Input value={d.headline} maxLength={40} onChange={(e) => set({ headline: e.target.value })} /></Field>
          <Field label="自我介绍" className="sm:col-span-2" hint="请不要在这里写电话、邮箱、微信，企业解锁前会被自动隐藏"><Textarea value={d.summary} onChange={(e) => set({ summary: e.target.value })} /></Field>
        </>
      )}
    </div>
  )
}

export function IntentFields({ d, set }: P) {
  return (
    <div className="space-y-4">
      <Field label="求职类型" required>
        <div className="flex flex-wrap gap-2">{(Object.keys(JOB_TYPE_LABEL) as JobType[]).map((t) => <Chip key={t} active={d.intents.includes(t)} onClick={() => set({ intents: toggleIn(d.intents, t) })}>{JOB_TYPE_LABEL[t]}</Chip>)}</div>
      </Field>
      <Field label="意向地区" required>
        <div className="flex flex-wrap gap-2">{STATES.map((s) => <Chip key={s} active={d.states.includes(s)} onClick={() => set({ states: toggleIn(d.states, s) })}>{s}</Chip>)}</div>
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="最早到岗" required><Input type="month" value={d.availableFrom} onChange={(e) => set({ availableFrom: e.target.value })} /></Field>
        <Field label="期望薪资"><Input value={d.expectedSalary} placeholder="RM 1,500 / 月" onChange={(e) => set({ expectedSalary: e.target.value })} /></Field>
      </div>
    </div>
  )
}

export function SkillFields({ d, set, withHeadline }: P & { withHeadline?: boolean }) {
  const has = (lang: string) => d.languages.some((l) => l.lang === lang)
  const toggleLang = (lang: string) =>
    set({ languages: has(lang) ? d.languages.filter((l) => l.lang !== lang) : [...d.languages, { lang, level: 'CONVERSATIONAL' }] })
  return (
    <div className="space-y-4">
      {withHeadline && <Field label="一句话介绍" required hint="HR 第一眼看到的就是这句"><Input value={d.headline} maxLength={40} placeholder="例：会做产品的前端，想去跨境电商公司实习" onChange={(e) => set({ headline: e.target.value })} /></Field>}
      <Field label="技能标签" required hint="至少 3 个，输入后按回车添加，最多 30 个"><TagInput value={d.skills} onChange={(skills) => set({ skills })} placeholder="如：React、AutoCAD、ACCA" /></Field>
      <div>
        <p className="mb-2 text-sm font-medium text-gray-700">语言能力</p>
        <div className="mb-3 flex flex-wrap gap-2">{LANGS.map((l) => <Chip key={l} active={has(l)} onClick={() => toggleLang(l)}>{l}</Chip>)}</div>
        <div className="space-y-2">
          {d.languages.map((l, i) => (
            <div key={l.lang} className="flex items-center gap-3">
              <span className="w-16 text-sm">{l.lang}</span>
              <Select value={l.level} onChange={(e) => set({ languages: d.languages.map((x, k) => (k === i ? { ...x, level: e.target.value as LangLevel } : x)) })}>
                {Object.entries(LANG_LEVEL_LABEL).map(([v, t]) => <option key={v} value={v}>{t}</option>)}
              </Select>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

export function ContactFields({ d, set, phoneOnly }: P & { phoneOnly?: boolean }) {
  const c = (p: Partial<Student['contact']>) => set({ contact: { ...d.contact, ...p } })
  return (
    <div className="space-y-4">
      <p className="flex gap-2 rounded-lg bg-emerald-50 p-3 text-xs text-emerald-800"><Lock className="size-4 shrink-0" />联系方式加密保存，只有你投递的企业，或付费解锁你的认证企业才能看到。</p>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="手机号"><Input value={d.contact.phone} onChange={(e) => c({ phone: e.target.value })} /></Field>
        {!phoneOnly && (
          <>
            <Field label="联系邮箱"><Input value={d.contact.email} onChange={(e) => c({ email: e.target.value })} /></Field>
            <Field label="WhatsApp"><Input value={d.contact.whatsapp} onChange={(e) => c({ whatsapp: e.target.value })} /></Field>
            <Field label="微信"><Input value={d.contact.wechat} onChange={(e) => c({ wechat: e.target.value })} /></Field>
          </>
        )}
      </div>
    </div>
  )
}

export function ExperienceForm({ exp, setExp }: { exp: Experience; setExp: (e: Experience) => void }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Field label="类型"><Select value={exp.kind} onChange={(e) => setExp({ ...exp, kind: e.target.value as Experience['kind'] })}>{['实习', '工作', '项目', '校园', '奖项'].map((k) => <option key={k}>{k}</option>)}</Select></Field>
      <Field label="时间"><Input value={exp.period} placeholder="2025.07 - 2025.09" onChange={(e) => setExp({ ...exp, period: e.target.value })} /></Field>
      <Field label="名称 / 职位" required><Input value={exp.title} onChange={(e) => setExp({ ...exp, title: e.target.value })} /></Field>
      <Field label="公司 / 组织"><Input value={exp.org} onChange={(e) => setExp({ ...exp, org: e.target.value })} /></Field>
      <Field label="描述" className="sm:col-span-2" hint="试试在这里写一个手机号，再到企业端看这份档案：解锁前会显示为 [已隐藏]"><Textarea value={exp.desc} onChange={(e) => setExp({ ...exp, desc: e.target.value })} /></Field>
    </div>
  )
}
