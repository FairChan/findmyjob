import { DEGREE_LABEL, WORK_AUTH_LABEL, schoolById, type Student } from '../data/mock'
import { completeness, maskName } from './privacy'

// 标准化简历：HR 一眼扫完的统一格式（PRD v0.2 §3.4）
export interface StandardRow {
  name: string; school: string; major: string; degree: string; grad: string; cgpa: string
  workAuth: string; languages: string; internships: number; campus: number; completeness: number
}

export function toStandardRow(s: Student, opts: { masked: boolean }): StandardRow {
  return {
    name: opts.masked ? maskName(s.fullName) : s.fullName,
    school: schoolById(s.schoolId)?.short ?? '—',
    major: s.major || '—',
    degree: DEGREE_LABEL[s.degree] ?? '—',
    grad: s.gradYear ? `${s.gradYear}-${String(s.gradMonth || 1).padStart(2, '0')}` : '—',
    cgpa: s.cgpa !== undefined ? s.cgpa.toFixed(2) : '—',
    workAuth: WORK_AUTH_LABEL[s.workAuth] ?? '—',
    languages: s.languages.slice(0, 2).map((l) => l.lang).join('、') || '—',
    internships: s.experiences.filter((e) => e.kind === '实习').length,
    campus: s.experiences.filter((e) => e.kind === '校园').length,
    completeness: completeness(s).score,
  }
}
