import type { Student } from '../data/mock'

// 对应 PRD §3.2：企业解锁前只能看到脱敏姓名
const COMPOUND = ['欧阳', '司马', '诸葛', '上官', '东方', '皇甫', '尉迟', '公孙', '慕容', '长孙', '令狐', '夏侯']
export function maskName(name: string) {
  const t = name.trim()
  if (/^[一-龥]/.test(t)) return `${COMPOUND.find((c) => t.startsWith(c)) ?? t[0]}同学`
  return `${(t[0] ?? '?').toUpperCase()}. 同学`
}

// 对应 ARCHITECTURE §5.2 的 redact：自由文本里的联系方式一律隐藏
const HIDDEN = '[已隐藏]'
export function redact(text: string) {
  return text
    .replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, HIDDEN)
    .replace(/(https?:\/\/|www\.)[^\s，。；、]+/gi, HIDDEN)
    .replace(/\b[a-z0-9-]+\.(com|my|cn|net|io|me)(\/[^\s，。；、]*)?/gi, HIDDEN)
    .replace(/(微信|WeChat|wechat|wx|WX)(号|ID|id)?\s*[:：]?\s*[A-Za-z][\w-]{4,19}/g, `$1：${HIDDEN}`)
    .replace(/(?<!\d)(\+?(60|86)[\s-]?)?0?1\d{1,2}[\s-]?\d{3,4}[\s-]?\d{4}(?!\d)/g, HIDDEN)
}

// 对应 PRD §2.2 的完成度权重
export function completeness(s: Student) {
  const items = [
    { label: '基本信息', pts: 30, got: [s.fullName, s.schoolId, s.degree, s.major, s.gradYear, s.workAuth].filter(Boolean).length * 5 },
    { label: '求职意向', pts: 15, got: (s.intents.length ? 5 : 0) + (s.states.length ? 5 : 0) + (s.availableFrom ? 5 : 0) },
    { label: '语言与技能', pts: 20, got: (s.languages.length ? 7 : 0) + (s.skills.length >= 3 ? 7 : 0) + (s.headline ? 6 : 0) },
    { label: '经历', pts: 20, got: (s.experiences.length ? 10 : 0) + (s.education.length ? 10 : 0) },
    { label: '附件简历', pts: 10, got: s.hasResume ? 10 : 0 },
    { label: '联系方式', pts: 5, got: s.contact.phone || s.contact.email ? 5 : 0 },
  ]
  return { score: items.reduce((a, b) => a + b.got, 0), items }
}

export const MIN_COMPLETENESS = 60

/** 分步向导里第一个没填完的步骤；全部填完返回 null（PRD v0.2 §2.2） */
export function firstIncompleteStep(s: Student): 1 | 2 | 3 | 4 | null {
  if (![s.fullName, s.schoolId, s.degree, s.major, s.gradYear, s.workAuth].every(Boolean)) return 1
  if (!s.intents.length || !s.states.length || !s.availableFrom) return 2
  if (!s.languages.length || s.skills.length < 3 || !s.headline) return 3
  if (!s.education.length) return 4
  return null
}
