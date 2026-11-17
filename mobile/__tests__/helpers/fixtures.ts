// 合成数据（无真实公司和个人）；id 用 cuid 形状，满足输入 schema 的 cuid 校验
import type {
  MobileJobListItem,
  MobileJobOpen,
  MobileProfile,
  MobileProfileCompleteness,
  MobileQuota,
} from '@shared/mobile-api'

export const ids = {
  job: (n: number) => `cjob${String(n).padStart(21, '0')}`,
  company: 'ccompany00000000000000001',
  school: 'cschool000000000000000001',
  resume: 'cresume000000000000000001',
  resume2: 'cresume000000000000000002',
  application: 'capplication0000000000001',
  invitation: 'cinvitation00000000000001',
}

export const company = { id: ids.company, legalName: 'Contoso Sdn Bhd', displayNameZh: '示例科技', displayNameEn: 'Contoso Tech' }

export function job(n: number, patch: Partial<MobileJobListItem> = {}): MobileJobListItem {
  return {
    id: ids.job(n),
    title: `前端实习生 ${n}`,
    type: 'INTERNSHIP',
    category: null,
    workMode: 'HYBRID',
    state: 'KUL',
    city: 'Kuala Lumpur',
    salaryMin: 2000,
    salaryMax: 3000,
    languages: ['zh'],
    skills: ['React'],
    acceptsStudentPass: true,
    sponsorsWorkPass: false,
    headcount: 2,
    deadline: null,
    publishedAt: '2026-11-01T00:00:00.000Z',
    company,
    ...patch,
  }
}

export const quota = (used: number, limit: number | null = 10): MobileQuota => ({ used, limit, next: 3, qualified: 0 })

export function openResult(n: number, patch: Partial<MobileJobOpen> = {}): MobileJobOpen {
  return {
    allowed: true,
    quota: quota(4),
    job: job(n),
    detail: { ...job(n), description: '负责 React Native 页面开发。', requirements: '熟悉 TypeScript', benefits: null },
    application: null,
    applyBlocker: null,
    resumes: [
      { id: ids.resume, fileName: 'resume-zh.pdf', isPrimary: true },
      { id: ids.resume2, fileName: 'resume-en.pdf', isPrimary: false },
    ],
    ...patch,
  }
}

export const profile: MobileProfile = {
  fullName: '李同学',
  schoolId: ids.school,
  degreeLevel: 'BACHELOR',
  major: '计算机科学',
  graduationYear: 2027,
  graduationMonth: 6,
  cgpa: 3.5,
  nationality: 'CN',
  workAuth: 'STUDENT_PASS',
  intents: ['INTERNSHIP'],
  availableFrom: null,
  preferredStates: ['KUL'],
  preferredIndustries: [],
  expectedSalaryMin: null,
  expectedSalaryMax: null,
  skills: ['React'],
  headline: null,
  summary: null,
  onboardingStep: 1,
  languages: [{ language: 'zh', level: 'NATIVE' }],
  educations: [],
  experiences: [],
}

export const completeness = (patch: Partial<MobileProfileCompleteness> = {}): MobileProfileCompleteness => ({
  completeness: 60,
  schoolVerified: false,
  hasResume: false,
  hasContact: false,
  talentPoolEnabled: false,
  ...patch,
})

export const schools = {
  items: [{ id: ids.school, nameZh: '示例大学马来西亚分校', nameEn: 'Example University Malaysia', emailDomains: ['example.edu.my'] }],
}

export const me = { id: 'cuser0000000000000000001', role: 'STUDENT' as const, name: '李同学', email: 'student@example.test', emailVerified: true, locale: 'zh' as const }
